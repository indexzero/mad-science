import HumanishCore
@testable import HumanishDarwin
import XCTest

@MainActor
final class HumanishDarwinTests: XCTestCase {
    func testMotionPlayerEmitsThePlannedCoordinates() async throws {
        let sink = RecordingSink()
        let player = ForegroundMotionPlayer(sink: sink, sleeper: { _ in })
        let samples = [
            TimedPoint(offsetNanoseconds: 0, position: Point2D(x: 1, y: 2)),
            TimedPoint(offsetNanoseconds: 0, position: Point2D(x: 3, y: 4)),
        ]
        let plan = try MotionPlan(
            model: "test", predictedSeconds: 0, distance: 3, targetWidth: 2, samples: samples)
        let events = try await player.play(plan)
        XCTAssertEqual(sink.points, samples.map(\.position))
        XCTAssertEqual(events.map(\.kind), [.move, .move])
    }

    func testPeekabooBaselinePrescriptionIsExplicitAndSeeded() {
        let plan = PeekabooMovementPrescription(
            model: "peekaboo-human",
            profile: .peekabooHuman,
            destination: Point2D(x: 8, y: 9),
            requestedDurationMilliseconds: 450,
            stepsHint: 54,
            randomSeed: 99)
        XCTAssertEqual(plan.model, "peekaboo-human")
        XCTAssertEqual(plan.profile, .peekabooHuman)
        XCTAssertEqual(plan.overshootProbability, 0.2)
        XCTAssertEqual(plan.randomSeed, 99)
    }

    func testAccessibilityTargetMatcherRejectsDisabledAndEmptyTargets() {
        let disabled = self.snapshot(id: "disabled", label: "Climb the copper ladder", enabled: false)
        let empty = self.snapshot(
            id: "empty",
            label: "Climb the copper ladder",
            enabled: true,
            bounds: Rect2D(x: 0, y: 0, width: 0, height: 0))
        let enabled = self.snapshot(id: "enabled", label: "Climb the Copper Ladder", enabled: true)

        XCTAssertEqual(
            AccessibilityTargetMatcher.firstEnabledMatch(
                for: "Climb the copper ladder",
                in: [disabled, empty, enabled])?.id,
            "enabled")
    }

    private func snapshot(
        id: String,
        label: String,
        enabled: Bool,
        bounds: Rect2D = Rect2D(x: 10, y: 20, width: 30, height: 40))
        -> AccessibilityElementSnapshot
    {
        AccessibilityElementSnapshot(
            id: id,
            type: "button",
            label: label,
            value: nil,
            bounds: bounds,
            isEnabled: enabled,
            attributes: [:])
    }
}

@MainActor
private final class RecordingSink: PointerEventSink {
    var points: [Point2D] = []

    func post(kind _: PointerEventKind, at point: Point2D) throws {
        self.points.append(point)
    }
}
