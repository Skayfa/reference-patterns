import Foundation

// Neutral demo domain: a notes app. The outbox itself is domain-agnostic —
// swap Note/NoteGateway for your entities.

public typealias NoteID = String

public struct NoteDraft: Codable, Sendable, Equatable {
    public var title: String

    public init(title: String) {
        self.title = title
    }
}

public struct Note: Codable, Sendable, Equatable, Identifiable {
    public var id: NoteID
    public var title: String
    public var tags: [String: Bool]

    public init(id: NoteID, title: String, tags: [String: Bool] = [:]) {
        self.id = id
        self.title = title
        self.tags = tags
    }
}

/// The error currency above the sync seam: transient errors are retried,
/// terminal errors remove the op and are reported to the caller.
public enum SyncError: Error, Sendable, Equatable {
    case transient(String)
    case terminal(String)

    public var isTransient: Bool {
        if case .transient = self { return true }
        return false
    }
}

/// The server seam. The enabling contract for the whole pattern: the CLIENT
/// generates entity IDs, and the server treats create as an idempotent upsert
/// keyed by that id — so outbox retries can never duplicate an entity.
public protocol NoteGateway: Sendable {
    func createNote(_ draft: NoteDraft, id: NoteID) async throws(SyncError) -> Note
    func rename(note: NoteID, title: String) async throws(SyncError) -> Note
    func setTags(note: NoteID, toggles: [String: Bool]) async throws(SyncError) -> Note
}

/// Client-side UUIDv4 — creation completes on device, sync happens later.
public func newNoteID() -> NoteID {
    UUID().uuidString.lowercased()
}
