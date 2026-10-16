// swift-tools-version: 6.2

import PackageDescription

let package = Package(
    name: "humanish",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "HumanishCore", targets: ["HumanishCore"]),
        .library(name: "HumanishDarwin", targets: ["HumanishDarwin"]),
        .executable(name: "humanish", targets: ["humanish"]),
    ],
    dependencies: [
        .package(
            url: "https://github.com/openclaw/Peekaboo.git",
            revision: "653645cbddb596c8077940fce2506a32cb48f580"),
    ],
    targets: [
        .target(name: "HumanishCore"),
        .target(
            name: "HumanishDarwin",
            dependencies: [
                "HumanishCore",
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ]),
        .executableTarget(
            name: "humanish",
            dependencies: ["HumanishCore", "HumanishDarwin"]),
        .testTarget(name: "HumanishCoreTests", dependencies: ["HumanishCore"]),
        .testTarget(name: "HumanishDarwinTests", dependencies: ["HumanishDarwin"]),
    ],
    swiftLanguageModes: [.v6])
