//! Lexical retrieval with **BM25** — the standard bag-of-words ranker
//! (what Lucene/Elasticsearch use by default), in ~40 lines of std, zero
//! dependencies. Chunk text, then rank chunks against a query. Pure
//! functions — no I/O, no model — so the ranking is unit-testable directly.
//!
//! Why not embeddings: they need a model (network or a heavy dependency)
//! and are the overhyped part of retrieval. BM25 wins most real retrieval by
//! rewarding rare terms (IDF) and normalizing for document length.

use std::collections::{HashMap, HashSet};

/// A chunk of a document: where it came from, and its text.
#[derive(Debug, Clone)]
pub struct Chunk {
    pub source: String,
    pub start_line: usize, // 1-indexed, inclusive
    pub end_line: usize,
    pub text: String,
}

/// One ranked hit: a reference to a chunk and its BM25 score.
#[derive(Debug)]
pub struct Hit<'a> {
    pub chunk: &'a Chunk,
    pub score: f64,
}

/// Split `text` into overlapping windows of `window` lines, stepping by
/// `window - overlap`. Overlap keeps a relevant passage from being split
/// across a boundary and lost.
pub fn chunk_lines(source: &str, text: &str, window: usize, overlap: usize) -> Vec<Chunk> {
    let lines: Vec<&str> = text.lines().collect();
    if lines.is_empty() {
        return Vec::new();
    }
    let step = window.saturating_sub(overlap).max(1);
    let mut chunks = Vec::new();
    let mut start = 0;
    while start < lines.len() {
        let end = (start + window).min(lines.len());
        chunks.push(Chunk {
            source: source.to_string(),
            start_line: start + 1,
            end_line: end,
            text: lines[start..end].join("\n"),
        });
        if end == lines.len() {
            break;
        }
        start += step;
    }
    chunks
}

/// Rank `chunks` against `query` with BM25 and return the top `top_k`, best
/// first. Chunks that share no query term are dropped.
pub fn bm25_top_k<'a>(query: &str, chunks: &'a [Chunk], top_k: usize) -> Vec<Hit<'a>> {
    // k1 controls term-frequency saturation; b controls length penalty.
    const K1: f64 = 1.5;
    const B: f64 = 0.75;

    let q_terms = tokenize(query);
    if q_terms.is_empty() || chunks.is_empty() {
        return Vec::new();
    }

    let docs: Vec<Vec<String>> = chunks.iter().map(|c| tokenize(&c.text)).collect();
    let n = docs.len() as f64;
    let avgdl = docs.iter().map(Vec::len).sum::<usize>() as f64 / n;

    // df(t): in how many chunks does term t appear (once per chunk).
    let mut df: HashMap<&str, usize> = HashMap::new();
    for doc in &docs {
        let unique: HashSet<&str> = doc.iter().map(String::as_str).collect();
        for t in unique {
            *df.entry(t).or_insert(0) += 1;
        }
    }

    let mut hits: Vec<Hit> = chunks
        .iter()
        .enumerate()
        .map(|(i, chunk)| {
            let doc = &docs[i];
            let dl = doc.len() as f64;
            let mut score = 0.0;
            for t in &q_terms {
                let f = doc.iter().filter(|w| w.as_str() == t.as_str()).count() as f64;
                if f == 0.0 {
                    continue;
                }
                let n_t = *df.get(t.as_str()).unwrap_or(&0) as f64;
                // IDF with the +1 (Lucene) variant so common terms never go
                // negative — a rare term contributes far more than a common one.
                let idf = ((n - n_t + 0.5) / (n_t + 0.5) + 1.0).ln();
                score += idf * (f * (K1 + 1.0)) / (f + K1 * (1.0 - B + B * dl / avgdl));
            }
            Hit { chunk, score }
        })
        .filter(|h| h.score > 0.0)
        .collect();

    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    hits.truncate(top_k);
    hits
}

/// Lowercase and split on non-alphanumerics. Naive on purpose (no stemming,
/// so "retry" != "retries") — a real system would stem.
fn tokenize(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(str::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(source: &str, text: &str) -> Chunk {
        Chunk { source: source.into(), start_line: 1, end_line: 1, text: text.into() }
    }

    #[test]
    fn ranks_the_more_relevant_chunk_first() {
        let chunks = vec![
            chunk("a", "the cat sat on the mat"),
            chunk("b", "database connection pooling and retries"),
            chunk("c", "we retry the database connection on failure with pooling"),
        ];
        let hits = bm25_top_k("database connection retry", &chunks, 3);
        assert_eq!(hits[0].chunk.source, "c"); // matches all three query terms
        assert!(hits.iter().all(|h| h.chunk.source != "a")); // shares no term
    }

    #[test]
    fn rarer_terms_win_over_common_ones() {
        let chunks = vec![
            chunk("common", "the the the the the the"),
            chunk("rare", "the kubernetes operator"),
        ];
        let hits = bm25_top_k("the kubernetes", &chunks, 2);
        assert_eq!(hits[0].chunk.source, "rare");
    }

    #[test]
    fn empty_query_or_corpus_yields_nothing() {
        let chunks = vec![chunk("a", "hello world")];
        assert!(bm25_top_k("", &chunks, 5).is_empty());
        assert!(bm25_top_k("hello", &[], 5).is_empty());
    }

    #[test]
    fn chunking_overlaps_windows() {
        let text = (1..=10).map(|i| i.to_string()).collect::<Vec<_>>().join("\n");
        let chunks = chunk_lines("f", &text, 4, 2);
        assert_eq!((chunks[0].start_line, chunks[0].end_line), (1, 4));
        assert_eq!(chunks[1].start_line, 3); // step = window - overlap = 2
    }
}
