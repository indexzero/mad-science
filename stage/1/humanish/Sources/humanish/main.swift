import Foundation
import HumanishCore
import HumanishDarwin

@main
struct HumanishCLI {
    @MainActor
    static func main() async {
        do {
            try await self.run(Array(CommandLine.arguments.dropFirst()))
        } catch {
            FileHandle.standardError.write(Data("humanish: \(error)\n".utf8))
            Foundation.exit(1)
        }
    }

    @MainActor
    private static func run(_ arguments: [String]) async throws {
        guard let command = arguments.first else {
            print(Self.usage)
            return
        }
        let args = Array(arguments.dropFirst())
        switch command {
        case "doctor":
            try self.printJSON(DarwinPermissionState())
        case "observe-ax":
            let policy = ExperimentCondition.computerAccessibility.observationPolicy
            try policy.requireAccessibility()
            let observer = PeekabooAccessibilityObserver()
            guard await observer.hasPermission() else { throw CLIError.accessibilityPermissionMissing }
            try self.printJSON(try await observer.observeFrontmost())
        case "capture":
            guard let path = args.first else { throw CLIError.missingOption("output path") }
            let observer = PeekabooScreenshotObserver()
            guard await observer.hasPermission() else { throw CLIError.screenRecordingPermissionMissing }
            try await observer.captureFrontmost().write(to: URL(fileURLWithPath: path), options: .atomic)
            print(path)
        case "plan":
            let start = try self.point(self.option("--from", in: args))
            let end = try self.point(self.option("--to", in: args))
            let width = try self.double(self.option("--width", in: args), name: "--width")
            let planner = MinimumJerkPlanner(fitts: FittsLaw(interceptSeconds: 0.05, slopeSecondsPerBit: 0.15))
            try self.printJSON(try planner.plan(from: start, to: end, targetWidth: width))
        case "compare":
            let path = try self.requiredOption("--reference", in: args)
            let observed = try self.double(self.option("--observed", in: args), name: "--observed")
            let distance = try self.double(self.option("--distance", in: args), name: "--distance")
            let width = try self.double(self.option("--width", in: args), name: "--width")
            let data = try Data(contentsOf: URL(fileURLWithPath: path))
            let dataset = try JSONDecoder().decode(LiteratureTimingDataset.self, from: data)
            try self.printJSON(try dataset.distribution(distance: distance, width: width).compare(observed))
        case "treatments":
            try self.printJSON(TreatmentCatalog.all)
        case "verify":
            let path = try self.requiredOption("--artifacts", in: args)
            let result = try TrialStore(directory: URL(fileURLWithPath: path)).verifyTerminal()
            try self.printJSON(result)
            if !result.valid { throw CLIError.artifactVerificationFailed }
        case "run-ax":
            try await self.runAccessibilityTrial(args, routeLabels: nil)
        case "run-route-ax":
            try await self.runAccessibilityTrial(args, routeLabels: [
                "Open the brass hatch",
                "Climb the copper ladder",
                "Look through the brass telescope",
            ])
        default:
            throw CLIError.unknownCommand(command)
        }
    }

    @MainActor
    private static func runAccessibilityTrial(_ args: [String], routeLabels: [String]?) async throws {
        guard args.contains("--armed") else { throw CLIError.notArmed }
        let labels = try routeLabels ?? [self.requiredOption("--label", in: args)]
        let artifactPath = try self.requiredOption("--artifacts", in: args)
        let model = self.option("--model", in: args) ?? "peekaboo-human"
        let seed = UInt64(self.option("--seed", in: args) ?? "1") ?? 1
        let treatment: AutomationTreatment
        do { treatment = try TreatmentCatalog.treatment(id: model) }
        catch { throw CLIError.invalidModel(model) }

        let permissions = DarwinPermissionState()
        guard permissions.accessibility else { throw CLIError.accessibilityPermissionMissing }
        guard permissions.screenRecording else { throw CLIError.screenRecordingPermissionMissing }

        let store = try TrialStore(directory: URL(fileURLWithPath: artifactPath))
        let manifest = TrialManifest(
            condition: .computerAccessibility,
            workload: "manhole-web-v1",
            model: model,
            modelStatus: treatment.modelStatus,
            treatment: treatment,
            randomSeed: seed)
        try store.write(manifest, named: "manifest.json")

        do {
            try await self.executeAccessibilityTrial(labels: labels, treatment: treatment, seed: seed, store: store)
            try store.write(
                TrialTerminal(status: "completed", artifacts: self.harnessArtifactDigests(store)),
                named: "terminal.json")
        } catch {
            try? store.write(
                TrialTerminal(
                    status: "failed",
                    artifacts: (try? self.harnessArtifactDigests(store)) ?? [],
                    message: String(describing: error)),
                named: "terminal.json")
            throw error
        }
        print(store.directory.path)
    }

    private static func harnessArtifactDigests(_ store: TrialStore) throws -> [ArtifactDigest] {
        try store.artifactDigests(excluding: ["terminal.json", "app-events.jsonl", "app-terminal.json"])
    }

    @MainActor
    private static func executeAccessibilityTrial(
        labels: [String],
        treatment: AutomationTreatment,
        seed: UInt64,
        store: TrialStore) async throws
    {
        let accessibility = PeekabooAccessibilityObserver()
        let screenshots = PeekabooScreenshotObserver()
        try await screenshots.captureFrontmost().write(
            to: store.directory.appendingPathComponent("before.png"), options: .atomic)
        let sink = CoreGraphicsPointerEventSink()
        let player = ForegroundMotionPlayer(sink: sink)
        let baseline = PeekabooMovementBaseline()
        for (index, label) in labels.enumerated() {
            let suffix = String(format: "%03d", index)
            let target = try await self.observeTarget(
                accessibility: accessibility,
                label: label,
                stepSuffix: suffix,
                store: store)
            guard let start = ForegroundMotionPlayer.currentPointerLocation() else {
                throw CLIError.pointerLocationUnavailable
            }
            let destination = target.bounds.center
            let movementSeconds = try treatment.movementDurationSeconds(
                distance: start.distance(to: destination),
                width: target.bounds.conservativeTargetWidth)
            let prescription = PeekabooMovementPrescription(
                model: treatment.id,
                profile: treatment.trajectory,
                destination: destination,
                requestedDurationMilliseconds: max(1, Int((movementSeconds * 1_000).rounded())),
                stepsHint: max(2, Int(ceil(movementSeconds * 120))),
                randomSeed: seed &+ UInt64(index))
            try store.write(prescription, named: "plan-\(suffix).json")

            if treatment.mentalPreparationSeconds > 0 {
                let started = DispatchTime.now().uptimeNanoseconds
                try await Task.sleep(nanoseconds: UInt64(treatment.mentalPreparationSeconds * 1_000_000_000))
                try store.appendJSONLine(
                    SchedulerEvent(
                        step: index,
                        phase: "mental-preparation",
                        plannedSeconds: treatment.mentalPreparationSeconds,
                        actualNanoseconds: DispatchTime.now().uptimeNanoseconds &- started),
                    named: "scheduler-events.jsonl")
            }

            let movementStarted = DispatchTime.now().uptimeNanoseconds
            try await baseline.move(prescription)
            try store.appendJSONLine(
                MovementDispatchEvent(
                    step: index,
                    label: label,
                    model: treatment.id,
                    requestedDurationMilliseconds: prescription.requestedDurationMilliseconds,
                    actualNanoseconds: DispatchTime.now().uptimeNanoseconds &- movementStarted,
                    destination: destination),
                named: "driver-events.jsonl")
            let clickEvents = try await player.click(
                at: destination,
                holdNanoseconds: UInt64(treatment.clickSeconds * 1_000_000_000))
            for event in clickEvents { try store.appendJSONLine(event, named: "driver-events.jsonl") }
            try await Task.sleep(nanoseconds: 350_000_000)
            try await screenshots.captureFrontmost().write(
                to: store.directory.appendingPathComponent("after-\(suffix).png"), options: .atomic)
        }
    }

    @MainActor
    private static func observeTarget(
        accessibility: PeekabooAccessibilityObserver,
        label: String,
        stepSuffix: String,
        store: TrialStore,
        maximumAttempts: Int = 12,
        retryNanoseconds: UInt64 = 125_000_000) async throws -> AccessibilityElementSnapshot
    {
        for attempt in 0..<maximumAttempts {
            let elements = try await accessibility.observeFrontmost(requiresFreshAccessibilityTree: true)
            let attemptSuffix = String(format: "%03d", attempt)
            try store.write(
                elements,
                named: "observation-\(stepSuffix)-attempt-\(attemptSuffix).json")
            if let target = AccessibilityTargetMatcher.firstEnabledMatch(for: label, in: elements) {
                try store.write(elements, named: "observation-\(stepSuffix).json")
                return target
            }
            if attempt + 1 < maximumAttempts {
                try await Task.sleep(nanoseconds: retryNanoseconds)
            }
        }
        throw CLIError.targetNotFound(label)
    }

    private static func option(_ name: String, in args: [String]) -> String? {
        guard let index = args.firstIndex(of: name), args.indices.contains(index + 1) else { return nil }
        return args[index + 1]
    }

    private static func requiredOption(_ name: String, in args: [String]) throws -> String {
        guard let value = self.option(name, in: args) else { throw CLIError.missingOption(name) }
        return value
    }

    private static func point(_ raw: String?) throws -> Point2D {
        guard let raw else { throw CLIError.missingOption("point") }
        let parts = raw.split(separator: ",").compactMap { Double($0) }
        guard parts.count == 2 else { throw CLIError.invalidPoint(raw) }
        return Point2D(x: parts[0], y: parts[1])
    }

    private static func double(_ raw: String?, name: String) throws -> Double {
        guard let raw, let value = Double(raw) else { throw CLIError.missingOption(name) }
        return value
    }

    private static func printJSON<T: Encodable>(_ value: T) throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        print(String(decoding: try encoder.encode(value), as: UTF8.self))
    }

    private static let usage = """
    humanish doctor
    humanish observe-ax
    humanish capture OUTPUT.png
    humanish plan --from X,Y --to X,Y --width POINTS
    humanish compare --reference DATASET.json --observed SECONDS --distance POINTS --width POINTS
    humanish treatments
    humanish verify --artifacts DIRECTORY
    humanish run-ax --label TEXT --artifacts DIRECTORY --armed \
      [--model TREATMENT] [--seed N]
    humanish run-route-ax --artifacts DIRECTORY --armed \
      [--model TREATMENT] [--seed N]

    run-ax defaults to peekaboo-human, an intentionally unvalidated machine baseline.
    """
}

private struct SchedulerEvent: Codable {
    let step: Int
    let phase: String
    let plannedSeconds: Double
    let actualNanoseconds: UInt64
}

private struct MovementDispatchEvent: Codable {
    let kind: String
    let step: Int
    let label: String
    let model: String
    let requestedDurationMilliseconds: Int
    let actualNanoseconds: UInt64
    let destination: Point2D

    init(
        step: Int,
        label: String,
        model: String,
        requestedDurationMilliseconds: Int,
        actualNanoseconds: UInt64,
        destination: Point2D)
    {
        self.kind = "movement-dispatch"
        self.step = step
        self.label = label
        self.model = model
        self.requestedDurationMilliseconds = requestedDurationMilliseconds
        self.actualNanoseconds = actualNanoseconds
        self.destination = destination
    }
}

private enum CLIError: Error, CustomStringConvertible {
    case unknownCommand(String)
    case missingOption(String)
    case invalidPoint(String)
    case invalidModel(String)
    case notArmed
    case accessibilityPermissionMissing
    case screenRecordingPermissionMissing
    case targetNotFound(String)
    case pointerLocationUnavailable
    case artifactVerificationFailed

    var description: String {
        switch self {
        case let .unknownCommand(value): "unknown command: \(value)"
        case let .missingOption(value): "missing or invalid option: \(value)"
        case let .invalidPoint(value): "invalid point (expected X,Y): \(value)"
        case let .invalidModel(value): "invalid model: \(value)"
        case .notArmed: "live foreground input requires --armed"
        case .accessibilityPermissionMissing: "Accessibility permission is missing; run `humanish doctor`"
        case .screenRecordingPermissionMissing:
            "Screen & System Audio Recording permission is missing; run `humanish doctor`"
        case let .targetNotFound(value): "no enabled accessibility target matched: \(value)"
        case .pointerLocationUnavailable: "could not read the current pointer location"
        case .artifactVerificationFailed: "trial artifact verification failed"
        }
    }
}
