import Foundation
import HumanishCore
import XCTest

final class HumanishCoreTests: XCTestCase {
    func testFittsUsesShannonFormulation() throws {
        let model = FittsLaw(interceptSeconds: 0.05, slopeSecondsPerBit: 0.15)
        XCTAssertEqual(try model.indexOfDifficulty(distance: 300, width: 30), log2(11), accuracy: 1e-12)
        XCTAssertEqual(try model.predictSeconds(distance: 0, width: 30), 0.05, accuracy: 1e-12)
    }

    func testMinimumJerkPlanHasExactEndpointsAndMonotonicTime() throws {
        let planner = MinimumJerkPlanner(
            fitts: FittsLaw(interceptSeconds: 0.05, slopeSecondsPerBit: 0.15),
            sampleRateHz: 120)
        let start = Point2D(x: 10, y: 20)
        let end = Point2D(x: 500, y: 280)
        let plan = try planner.plan(from: start, to: end, targetWidth: 42)
        XCTAssertEqual(plan.samples.first?.position, start)
        XCTAssertEqual(plan.samples.last?.position, end)
        XCTAssertTrue(zip(plan.samples, plan.samples.dropFirst()).allSatisfy {
            $0.offsetNanoseconds <= $1.offsetNanoseconds
        })
    }

    func testPixelConditionRejectsAccessibilityLeak() {
        XCTAssertThrowsError(try ExperimentCondition.computerPixels.observationPolicy.requireAccessibility())
        XCTAssertNoThrow(try ExperimentCondition.computerAccessibility.observationPolicy.requireAccessibility())
    }

    func testKLMCompositionUsesInspectableOperators() throws {
        let model = KLMModel(pointing: FittsLaw(interceptSeconds: 0.05, slopeSecondsPerBit: 0.15))
        let value = try model.predictSeconds(
            operators: [KLMOperator(.mentalPreparation), KLMOperator(.point), KLMOperator(.keystroke)],
            pointingDistance: 300,
            targetWidth: 30)
        XCTAssertEqual(value, 1.35 + 0.05 + 0.15 * log2(11) + 0.2, accuracy: 1e-12)
    }

    func testEmpiricalComparisonUsesDistributionWithoutAssumingNormality() throws {
        let distribution = try EmpiricalTimingDistribution(durations: [0.2, 0.3, 0.4, 0.8, 1.1])
        let comparison = try distribution.compare(0.4)
        XCTAssertEqual(distribution.median, 0.4, accuracy: 1e-12)
        XCTAssertEqual(comparison.empiricalPercentile, 0.6, accuracy: 1e-12)
        XCTAssertTrue(comparison.withinCentral90Percent)
    }

    func testTrialManifestNamesUnvalidatedMachineBaseline() throws {
        let manifest = TrialManifest(
            condition: .computerAccessibility,
            workload: "test",
            model: "peekaboo-human",
            modelStatus: .unvalidatedMachineBaseline,
            treatment: try TreatmentCatalog.treatment(id: "peekaboo-human"),
            randomSeed: 4)
        XCTAssertEqual(manifest.modelStatus, .unvalidatedMachineBaseline)
    }

    func testTreatmentCatalogSeparatesTrajectoryTimingAndCognition() throws {
        let priorArt = try TreatmentCatalog.treatment(id: "peekaboo-human")
        let research = try TreatmentCatalog.treatment(id: "peekaboo-human-fitts-goms")
        XCTAssertEqual(priorArt.motorTiming, .fixedLegacy)
        XCTAssertEqual(priorArt.cognitiveSchedule, .none)
        XCTAssertEqual(research.trajectory, .peekabooHuman)
        XCTAssertEqual(research.motorTiming, .fittsShannon)
        XCTAssertEqual(research.cognitiveSchedule, .klmGOMS)
        XCTAssertEqual(research.mentalPreparationSeconds, 1.35)
    }

    func testTerminalVerificationDetectsChangedArtifact() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("humanish-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try TrialStore(directory: directory)
        try store.write(["value": 1], named: "evidence.json")
        try store.write(
            TrialTerminal(status: "completed", artifacts: [try store.digest(named: "evidence.json")]),
            named: "terminal.json")
        XCTAssertTrue(try store.verifyTerminal().valid)
        try Data("changed".utf8).write(to: directory.appendingPathComponent("evidence.json"))
        let verification = try store.verifyTerminal()
        XCTAssertFalse(verification.valid)
        XCTAssertEqual(verification.changed, ["evidence.json"])
    }

    func testBrowserJournalRequiresItsOwnSeal() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("humanish-app-seal-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = try TrialStore(directory: directory)
        try store.write(TrialTerminal(status: "completed", artifacts: []), named: "terminal.json")
        try Data("{\"type\":\"test\"}\n".utf8).write(
            to: directory.appendingPathComponent("app-events.jsonl"))
        XCTAssertEqual(try store.verifyTerminal().missing, ["app-terminal.json"])
        let digest = try store.digest(named: "app-events.jsonl")
        try store.write(
            ["eventPath": "app-events.jsonl", "sha256": digest.sha256],
            named: "app-terminal.json")
        XCTAssertTrue(try store.verifyTerminal().valid)
    }
}
