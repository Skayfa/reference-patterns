//! Verify-then-retry: don't trust an output — check it against ground truth,
//! and if it fails, feed the diagnostics back and retry, bounded by a budget.
//! The antidote to "confidently wrong" (the classic LLM-agent failure), but
//! agent-agnostic: `solve_verified` takes any attempt closure, so it wraps a
//! code generator, an agent, a data pipeline — anything with a checkable
//! result.
//!
//! The key design choice: the check lives in the **caller's harness**, not
//! inside the thing being checked. You don't trust the producer to verify
//! itself — the loop and the source of truth for "done" are outside it.

use std::fmt;
use std::path::{Path, PathBuf};
use std::process::Command;

/// The outcome of a ground-truth check.
pub enum Verdict {
    Pass,
    Fail { details: String },
}

/// Decides whether the work is actually done. Behind a trait so it is
/// swappable and testable (a real command vs a scripted stub).
pub trait Verifier {
    fn verify(&self) -> Verdict;
}

/// Runs a shell command in a directory: exit 0 is a pass, anything else is a
/// fail carrying the command's output — exactly what you feed back (a
/// compiler error, a failing assertion, a lint).
pub struct CommandVerifier {
    command: String,
    dir: PathBuf,
}

impl CommandVerifier {
    pub fn new(command: impl Into<String>, dir: impl Into<PathBuf>) -> Self {
        Self { command: command.into(), dir: dir.into() }
    }
}

impl Verifier for CommandVerifier {
    fn verify(&self) -> Verdict {
        match Command::new("sh").arg("-c").arg(&self.command).current_dir(&self.dir).output() {
            Ok(o) if o.status.success() => Verdict::Pass,
            Ok(o) => {
                let mut details = String::from_utf8_lossy(&o.stdout).into_owned();
                details.push_str(&String::from_utf8_lossy(&o.stderr));
                Verdict::Fail { details: details.trim().to_string() }
            }
            Err(e) => Verdict::Fail { details: format!("could not run check: {e}") },
        }
    }
}

#[derive(Debug)]
pub enum VerifyError {
    /// The check never passed within the budget. This is the honest failure
    /// verification buys you: "did not converge", not a false success.
    NotConverged { attempts: usize, last_details: String },
}

impl fmt::Display for VerifyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let VerifyError::NotConverged { attempts, last_details } = self;
        write!(f, "did not pass in {attempts} attempts; last output:\n{last_details}")
    }
}
impl std::error::Error for VerifyError {}

/// Run `attempt`, then check; on failure feed the check's output back into the
/// next `attempt` and retry, up to `max_attempts`.
///
/// `attempt(feedback)` receives the previous failure details (`None` on the
/// first try), does its side-effecting work, and returns its answer. The
/// harness — not the attempt — decides when it is done.
pub fn solve_verified<A>(
    mut attempt: A,
    verifier: &dyn Verifier,
    max_attempts: usize,
) -> Result<String, VerifyError>
where
    A: FnMut(Option<&str>) -> String,
{
    let mut feedback: Option<String> = None;
    let mut last_details = String::new();

    for _ in 0..max_attempts {
        let answer = attempt(feedback.as_deref());
        match verifier.verify() {
            Verdict::Pass => return Ok(answer),
            Verdict::Fail { details } => {
                feedback = Some(format!(
                    "Your previous attempt did not pass. Check output:\n{details}\nFix it."
                ));
                last_details = details;
            }
        }
    }

    Err(VerifyError::NotConverged { attempts: max_attempts, last_details })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn temp_dir() -> PathBuf {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("verify-loop-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    // A scripted "producer": first attempt writes WIP (fails the check),
    // second writes DONE (passes) — a stand-in for a fallible generator.
    #[test]
    fn retries_until_the_ground_truth_check_passes() {
        let dir = temp_dir();
        let mut n = 0;
        let verifier = CommandVerifier::new("grep -q DONE solution.txt", dir.clone());

        let answer = solve_verified(
            |_feedback| {
                n += 1;
                let content = if n == 1 { "WIP" } else { "DONE" };
                std::fs::write(dir.join("solution.txt"), content).unwrap();
                format!("wrote {content}")
            },
            &verifier,
            5,
        )
        .unwrap();

        assert_eq!(answer, "wrote DONE");
        assert_eq!(std::fs::read_to_string(dir.join("solution.txt")).unwrap(), "DONE");
    }

    #[test]
    fn gives_up_honestly_after_the_budget() {
        let dir = temp_dir();
        let verifier = CommandVerifier::new("grep -q DONE solution.txt", dir.clone());
        // Always writes WIP -> never passes.
        let err = solve_verified(
            |_feedback| {
                std::fs::write(dir.join("solution.txt"), "WIP").unwrap();
                "still wip".to_string()
            },
            &verifier,
            3,
        )
        .unwrap_err();
        assert!(matches!(err, VerifyError::NotConverged { attempts: 3, .. }));
    }

    // The feedback from a failed check reaches the next attempt.
    #[test]
    fn feedback_is_threaded_into_the_next_attempt() {
        let dir = temp_dir();
        let verifier = CommandVerifier::new("test -f done.flag", dir.clone());
        let mut saw_feedback = false;
        let _ = solve_verified(
            |feedback| {
                if feedback.is_some() {
                    saw_feedback = true;
                    std::fs::write(dir.join("done.flag"), "").unwrap();
                }
                "attempt".to_string()
            },
            &verifier,
            3,
        );
        assert!(saw_feedback, "the second attempt should receive the failure feedback");
    }
}
