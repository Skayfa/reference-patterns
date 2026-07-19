import Foundation
import Testing

@testable import OpOutbox

private func tempStore<V: Codable & Sendable>(_ type: V.Type = V.self) -> DiskStore<V> {
    let dir = FileManager.default.temporaryDirectory
        .appendingPathComponent("op-outbox-tests-\(UUID().uuidString)", isDirectory: true)
    try! FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return DiskStore(url: dir.appendingPathComponent("outbox.json"))
}

/// Scripted double with a thread-safe call recorder — no network, no mocks lib.
private final class Recorder: @unchecked Sendable {
    private let lock = NSLock()
    private var calls: [String] = []

    func add(_ call: String) {
        lock.lock()
        calls.append(call)
        lock.unlock()
    }

    var recorded: [String] {
        lock.lock()
        defer { lock.unlock() }
        return calls
    }
}

private struct StubGateway: NoteGateway {
    var recorder = Recorder()
    var onCreate: @Sendable (NoteDraft, NoteID) throws(SyncError) -> Note = { draft, id throws(SyncError) in
        Note(id: id, title: draft.title)
    }
    var onRename: @Sendable (NoteID, String) throws(SyncError) -> Note = { id, title throws(SyncError) in
        Note(id: id, title: title)
    }

    func createNote(_ draft: NoteDraft, id: NoteID) async throws(SyncError) -> Note {
        recorder.add("create:\(id)")
        return try onCreate(draft, id)
    }

    func rename(note: NoteID, title: String) async throws(SyncError) -> Note {
        recorder.add("rename:\(note)")
        return try onRename(note, title)
    }

    func setTags(note: NoteID, toggles: [String: Bool]) async throws(SyncError) -> Note {
        recorder.add("tags:\(note):\(toggles.keys.sorted().joined(separator: "+"))")
        return Note(id: note, title: "", tags: toggles)
    }
}

@Suite struct CoalescingTests {
    @Test func renameReEditReplaces() async {
        let outbox = OpOutbox(disk: tempStore(), gateway: StubGateway())
        await outbox.enqueue(.rename(note: "n1", title: "first"))
        await outbox.enqueue(.rename(note: "n1", title: "second"))
        let entries = await outbox.pendingEntries
        #expect(entries.map(\.op) == [.rename(note: "n1", title: "second")])
    }

    @Test func tagTogglesMergeInsteadOfReplacing() async {
        // Toggling two tags offline must flush BOTH — replace-only coalescing
        // would silently drop the first toggle.
        let outbox = OpOutbox(disk: tempStore(), gateway: StubGateway())
        await outbox.enqueue(.tagToggles(note: "n1", toggles: ["urgent": true]))
        await outbox.enqueue(.tagToggles(note: "n1", toggles: ["done": true, "urgent": false]))
        let entries = await outbox.pendingEntries
        #expect(entries.map(\.op) == [.tagToggles(note: "n1", toggles: ["urgent": false, "done": true])])
    }

    @Test func distinctNotesNeverCoalesce() async {
        let outbox = OpOutbox(disk: tempStore(), gateway: StubGateway())
        await outbox.enqueue(.rename(note: "n1", title: "a"))
        await outbox.enqueue(.rename(note: "n2", title: "b"))
        #expect(await outbox.pendingEntries.count == 2)
    }
}

@Suite struct FlushOrderingTests {
    @Test func createFlushesBeforeItsEdits() async {
        let gateway = StubGateway()
        let outbox = OpOutbox(disk: tempStore(), gateway: gateway)
        await outbox.enqueue(.create(NoteDraft(title: "Offline note"), id: "n1"))
        await outbox.enqueue(.rename(note: "n1", title: "Renamed offline"))
        _ = await outbox.flush()
        #expect(gateway.recorder.recorded == ["create:n1", "rename:n1"])
        #expect(await outbox.pendingEntries.isEmpty)
    }

    @Test func transientCreateBlocksItsFollowersForThePass() async {
        var gateway = StubGateway()
        gateway.onCreate = { _, _ throws(SyncError) in throw SyncError.transient("offline") }
        let outbox = OpOutbox(disk: tempStore(), gateway: gateway)
        await outbox.enqueue(.create(NoteDraft(title: "n"), id: "n1"))
        await outbox.enqueue(.rename(note: "n1", title: "later"))
        let outcome = await outbox.flush()
        // The rename was never attempted (it would 404 server-side) and both
        // ops survive for the next trigger.
        #expect(gateway.recorder.recorded == ["create:n1"])
        #expect(outcome.acked.isEmpty && outcome.rejected.isEmpty)
        let entries = await outbox.pendingEntries
        #expect(entries.count == 2)
        #expect(entries[0].attempts == 1)
    }

    @Test func terminalCreateDropsItsFollowers() async {
        var gateway = StubGateway()
        gateway.onCreate = { _, _ throws(SyncError) in throw SyncError.terminal("rejected") }
        let outbox = OpOutbox(disk: tempStore(), gateway: gateway)
        await outbox.enqueue(.create(NoteDraft(title: "n"), id: "n1"))
        await outbox.enqueue(.rename(note: "n1", title: "later"))
        let outcome = await outbox.flush()
        // Orphan edits are reported, never silently kept or sent.
        #expect(outcome.rejected.count == 2)
        #expect(await outbox.pendingEntries.isEmpty)
    }

    @Test func transientCreateDoesNotBlockOtherNotes() async {
        var gateway = StubGateway()
        gateway.onCreate = { draft, id throws(SyncError) in
            if id == "n1" { throw SyncError.transient("offline") }
            return Note(id: id, title: draft.title)
        }
        let outbox = OpOutbox(disk: tempStore(), gateway: gateway)
        await outbox.enqueue(.create(NoteDraft(title: "stuck"), id: "n1"))
        await outbox.enqueue(.create(NoteDraft(title: "fine"), id: "n2"))
        let outcome = await outbox.flush()
        #expect(outcome.acked.map(\.id) == ["n2"])
        #expect(await outbox.pendingEntries.count == 1)
    }
}

@Suite struct MaterializingMergeTests {
    @Test func pendingCreateAppearsInLists() async {
        let outbox = OpOutbox(disk: tempStore(), gateway: StubGateway())
        await outbox.enqueue(.create(NoteDraft(title: "Metro note"), id: "n2"))
        await outbox.enqueue(.rename(note: "n2", title: "Metro note, renamed"))
        let merged = await outbox.merging(into: [Note(id: "n1", title: "From server")])
        #expect(merged.map(\.id) == ["n1", "n2"])
        #expect(merged[1].title == "Metro note, renamed")
    }

    @Test func ackedCreateIsNoLongerMaterialized() async {
        let outbox = OpOutbox(disk: tempStore(), gateway: StubGateway())
        await outbox.enqueue(.create(NoteDraft(title: "n"), id: "n1"))
        _ = await outbox.flush()
        // The server copy is now the truth; merging must not duplicate it.
        let merged = await outbox.merging(into: [Note(id: "n1", title: "n")])
        #expect(merged.count == 1)
    }

    @Test func pendingEditsApplyOnTopOfServerData() async {
        let outbox = OpOutbox(disk: tempStore(), gateway: StubGateway())
        await outbox.enqueue(.tagToggles(note: "n1", toggles: ["urgent": true]))
        let merged = await outbox.merging(into: [Note(id: "n1", title: "From server")])
        #expect(merged[0].tags == ["urgent": true])
    }
}

@Suite struct DurabilityTests {
    @Test func queueSurvivesActorReinstantiation() async {
        let disk: DiskStore<[OpOutbox.Pending]> = tempStore()
        let first = OpOutbox(disk: disk, gateway: StubGateway())
        await first.enqueue(.create(NoteDraft(title: "Survives app kill"), id: "n1"))

        let second = OpOutbox(disk: disk, gateway: StubGateway())
        let merged = await second.merging(into: [])
        #expect(merged.map(\.title) == ["Survives app kill"])
    }
}
