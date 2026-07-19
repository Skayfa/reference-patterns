import Foundation

/// Offline-first op outbox: every mutation is applied locally first, then
/// queued here, durable on disk, and flushed opportunistically.
///
/// Invariants:
/// - FIFO **per entity**: a create always flushes before that entity's edits.
///   A transient create failure BLOCKS its followers for the pass (kept);
///   a terminal create failure DROPS them (reported, never silent).
/// - Coalescing is **value-aware**: latest-wins ops (rename) replace their
///   pending predecessor; set-toggle ops (tags) merge — toggling two tags
///   offline must flush both.
/// - The outbox NEVER flushes autonomously. The composition root wires event
///   triggers (post-mutation, network path satisfied, app foregrounded) to a
///   single reconciliation point that calls flush() and applies the outcome.
public actor OpOutbox {
    public enum Op: Codable, Sendable, Equatable {
        case create(NoteDraft, id: NoteID)
        case rename(note: NoteID, title: String)
        case tagToggles(note: NoteID, toggles: [String: Bool])

        public var noteID: NoteID {
            switch self {
            case .create(_, let id): id
            case .rename(let id, _): id
            case .tagToggles(let id, _): id
            }
        }
    }

    public struct Pending: Codable, Sendable, Equatable {
        public var op: Op
        public var attempts: Int

        public init(op: Op, attempts: Int = 0) {
            self.op = op
            self.attempts = attempts
        }
    }

    public struct FlushOutcome: Sendable {
        public var acked: [Note] = []
        public var rejected: [(Op, SyncError)] = []
    }

    private var pending: [Pending]
    private let disk: DiskStore<[Pending]>
    private let gateway: any NoteGateway

    public init(disk: DiskStore<[Pending]>, gateway: any NoteGateway) {
        self.disk = disk
        self.gateway = gateway
        self.pending = disk.load() ?? []
    }

    public var pendingEntries: [Pending] { pending }

    public func enqueue(_ op: Op) {
        switch op {
        case .create:
            pending.append(Pending(op: op))
        case .rename(let note, _):
            // Latest wins: a re-edit replaces the queued rename.
            if let i = pending.firstIndex(where: { isRename($0.op, of: note) }) {
                pending[i] = Pending(op: op)
            } else {
                pending.append(Pending(op: op))
            }
        case .tagToggles(let note, let toggles):
            // Merge: every toggled tag must flush, later toggles win per key.
            if let i = pending.firstIndex(where: { isTagToggles($0.op, of: note) }),
               case .tagToggles(_, var existing) = pending[i].op {
                existing.merge(toggles) { _, new in new }
                pending[i] = Pending(op: .tagToggles(note: note, toggles: existing))
            } else {
                pending.append(Pending(op: op))
            }
        }
        persist()
    }

    public func flush() async -> FlushOutcome {
        var outcome = FlushOutcome()
        var kept: [Pending] = []
        var blocked = Set<NoteID>()   // transient create → followers wait for the next pass
        var dropped = Set<NoteID>()   // terminal create → followers are orphans, reported

        for var entry in pending {
            let id = entry.op.noteID
            if dropped.contains(id) {
                outcome.rejected.append((entry.op, .terminal("create was rejected")))
                continue
            }
            if blocked.contains(id) {
                kept.append(entry)
                continue
            }
            do {
                outcome.acked.append(try await send(entry.op))
            } catch let error where error.isTransient {
                entry.attempts += 1
                kept.append(entry)
                if case .create = entry.op { blocked.insert(id) }
            } catch {
                outcome.rejected.append((entry.op, error))
                if case .create = entry.op { dropped.insert(id) }
            }
        }
        pending = kept
        persist()
        return outcome
    }

    /// Offline-first read path: MATERIALIZES pending creates as full values
    /// (an entity created in the metro appears in every list) and applies
    /// pending edits on top of server data.
    public func merging(into notes: [Note]) -> [Note] {
        var result = notes
        for entry in pending {
            switch entry.op {
            case .create(let draft, let id):
                if !result.contains(where: { $0.id == id }) {
                    result.append(Note(id: id, title: draft.title))
                }
            case .rename(let note, let title):
                if let i = result.firstIndex(where: { $0.id == note }) {
                    result[i].title = title
                }
            case .tagToggles(let note, let toggles):
                if let i = result.firstIndex(where: { $0.id == note }) {
                    result[i].tags.merge(toggles) { _, new in new }
                }
            }
        }
        return result
    }

    // MARK: - internals

    private func send(_ op: Op) async throws(SyncError) -> Note {
        switch op {
        case .create(let draft, let id):
            try await gateway.createNote(draft, id: id)
        case .rename(let note, let title):
            try await gateway.rename(note: note, title: title)
        case .tagToggles(let note, let toggles):
            try await gateway.setTags(note: note, toggles: toggles)
        }
    }

    private func isRename(_ op: Op, of note: NoteID) -> Bool {
        if case .rename(let id, _) = op { return id == note }
        return false
    }

    private func isTagToggles(_ op: Op, of note: NoteID) -> Bool {
        if case .tagToggles(let id, _) = op { return id == note }
        return false
    }

    private func persist() {
        try? disk.save(pending)
    }
}
