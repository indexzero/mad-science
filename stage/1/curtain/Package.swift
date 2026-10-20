// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "curtain",
    platforms: [.macOS(.v26)],
    products: [
        .library(name: "CurtainCore", targets: ["CurtainCore"]),
        .executable(name: "curtain", targets: ["curtain"]),
    ],
    targets: [
        .target(name: "CurtainCore"),
        .executableTarget(
            name: "curtain",
            dependencies: ["CurtainCore"],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("CoreGraphics"),
                .linkedFramework("IOKit"),
                .linkedFramework("ApplicationServices"),
            ]
        ),
        .testTarget(name: "CurtainCoreTests", dependencies: ["CurtainCore"]),
    ]
)
