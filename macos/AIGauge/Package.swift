// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AIGauge",
    platforms: [
        .macOS(.v13)
    ],
    products: [
        .executable(name: "AIGauge", targets: ["AIGauge"])
    ],
    targets: [
        .executableTarget(
            name: "AIGauge",
            path: "Sources/AIGauge"
        )
    ]
)
