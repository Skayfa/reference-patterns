// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "OpOutbox",
    platforms: [.macOS(.v14), .iOS(.v17)],
    targets: [
        .target(name: "OpOutbox"),
        .testTarget(name: "OpOutboxTests", dependencies: ["OpOutbox"]),
    ]
)
