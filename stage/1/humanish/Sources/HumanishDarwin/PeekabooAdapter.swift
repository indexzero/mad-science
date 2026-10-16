import CoreGraphics
import Foundation
import HumanishCore
import PeekabooAutomationKit

public struct AccessibilityElementSnapshot: Codable, Equatable, Sendable {
    public let id: String
    public let type: String
    public let label: String?
    public let value: String?
    public let bounds: Rect2D
    public let isEnabled: Bool
    public let attributes: [String: String]

    public var searchableText: String {
        ([self.label, self.value, self.attributes["title"], self.attributes["description"]]
            .compactMap { $0 }).joined(separator: " ")
    }
}

public enum AccessibilityTargetMatcher {
    public static func firstEnabledMatch(
        for label: String,
        in elements: [AccessibilityElementSnapshot]) -> AccessibilityElementSnapshot?
    {
        elements
            .filter { $0.isEnabled && $0.bounds.width > 0 && $0.bounds.height > 0 }
            .first { $0.searchableText.localizedCaseInsensitiveContains(label) }
    }
}

@MainActor
public final class PeekabooAccessibilityObserver {
    private let automation: UIAutomationService

    public init(automation: UIAutomationService = UIAutomationService()) {
        self.automation = automation
    }

    public func hasPermission() async -> Bool {
        await self.automation.hasAccessibilityPermission()
    }

    public func observeFrontmost(
        requiresFreshAccessibilityTree: Bool = false) async throws -> [AccessibilityElementSnapshot]
    {
        let windowContext = requiresFreshAccessibilityTree
            ? WindowContext(
                requiresFreshAccessibilityTree: true,
                accessibilityTimeoutSeconds: 3)
            : nil
        let result = try await self.automation.inspectAccessibilityTree(windowContext: windowContext)
        return result.elements.all.map { element in
            AccessibilityElementSnapshot(
                id: element.id,
                type: element.type.rawValue,
                label: element.label,
                value: element.value,
                bounds: Rect2D(
                    x: element.bounds.origin.x,
                    y: element.bounds.origin.y,
                    width: element.bounds.width,
                    height: element.bounds.height),
                isEnabled: element.isEnabled,
                attributes: element.attributes)
        }
    }
}

public struct PeekabooMovementPrescription: Codable, Equatable, Sendable {
    public let model: String
    public let profile: TrajectoryStrategy
    public let destination: Point2D
    public let requestedDurationMilliseconds: Int
    public let stepsHint: Int
    public let jitterAmplitude: Double
    public let overshootProbability: Double
    public let overshootFractionLowerBound: Double
    public let overshootFractionUpperBound: Double
    public let settleRadius: Double
    public let randomSeed: UInt64?

    public init(
        model: String,
        profile: TrajectoryStrategy,
        destination: Point2D,
        requestedDurationMilliseconds: Int,
        stepsHint: Int,
        jitterAmplitude: Double = 0.35,
        overshootProbability: Double = 0.2,
        overshootFractionLowerBound: Double = 0.02,
        overshootFractionUpperBound: Double = 0.06,
        settleRadius: Double = 6,
        randomSeed: UInt64? = nil)
    {
        precondition(profile == .peekabooHuman || profile == .peekabooLinear)
        self.model = model
        self.profile = profile
        self.destination = destination
        self.requestedDurationMilliseconds = requestedDurationMilliseconds
        self.stepsHint = stepsHint
        self.jitterAmplitude = jitterAmplitude
        self.overshootProbability = overshootProbability
        self.overshootFractionLowerBound = overshootFractionLowerBound
        self.overshootFractionUpperBound = overshootFractionUpperBound
        self.settleRadius = settleRadius
        self.randomSeed = randomSeed
    }
}

@MainActor
public final class PeekabooMovementBaseline {
    private let automation: UIAutomationService

    public init(automation: UIAutomationService = UIAutomationService()) {
        self.automation = automation
    }

    public func move(_ prescription: PeekabooMovementPrescription) async throws {
        let configuration = HumanMouseProfileConfiguration(
            jitterAmplitude: prescription.jitterAmplitude,
            overshootProbability: prescription.overshootProbability,
            overshootFractionRange: (
                prescription.overshootFractionLowerBound...prescription.overshootFractionUpperBound),
            settleRadius: prescription.settleRadius,
            randomSeed: prescription.randomSeed)
        let profile: MouseMovementProfile = prescription.profile == .peekabooHuman
            ? .human(configuration)
            : .linear
        try await self.automation.moveMouse(
            to: CGPoint(x: prescription.destination.x, y: prescription.destination.y),
            duration: prescription.requestedDurationMilliseconds,
            steps: prescription.stepsHint,
            profile: profile)
    }
}

@MainActor
public final class PeekabooScreenshotObserver {
    private let capture: ScreenCaptureService

    public init() {
        self.capture = ScreenCaptureService(
            loggingService: LoggingService(subsystem: "dev.indexzero.humanish"))
    }

    public func hasPermission() async -> Bool {
        await self.capture.hasScreenRecordingPermission()
    }

    public func captureFrontmost() async throws -> Data {
        try await self.capture.captureFrontmost().imageData
    }
}
