import Foundation

/// Minimal atomic-file persistence. `.atomic` is rename-based and does not
/// require an existing original (first save on a fresh install works) —
/// unlike FileManager.replaceItemAt.
public struct DiskStore<Value: Codable & Sendable>: Sendable {
    public let url: URL

    public init(url: URL) {
        self.url = url
    }

    public func load() -> Value? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(Value.self, from: data)
    }

    public func save(_ value: Value) throws {
        try JSONEncoder().encode(value).write(to: url, options: .atomic)
    }
}
