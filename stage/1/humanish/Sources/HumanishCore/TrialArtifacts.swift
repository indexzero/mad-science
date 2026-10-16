import CryptoKit
import Foundation

public struct TrialManifest: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let trialID: UUID
    public let condition: ExperimentCondition
    public let workload: String
    public let model: String
    public let modelStatus: ModelEpistemicStatus
    public let treatment: AutomationTreatment?
    public let randomSeed: UInt64
    public let createdAt: Date

    public init(
        trialID: UUID = UUID(),
        condition: ExperimentCondition,
        workload: String,
        model: String,
        modelStatus: ModelEpistemicStatus,
        treatment: AutomationTreatment? = nil,
        randomSeed: UInt64,
        createdAt: Date = Date())
    {
        self.schemaVersion = 1
        self.trialID = trialID
        self.condition = condition
        self.workload = workload
        self.model = model
        self.modelStatus = modelStatus
        self.treatment = treatment
        self.randomSeed = randomSeed
        self.createdAt = createdAt
    }
}

public enum ModelEpistemicStatus: String, Codable, Equatable, Sendable {
    /// Existing machine behavior retained to measure, not accepted as a model of humans.
    case unvalidatedMachineBaseline = "unvalidated-machine-baseline"
    /// A research-controlled model whose assumptions and parameters are inspectable.
    case researchHypothesis = "research-hypothesis"
    /// An observed human trace, not a generated motor model.
    case humanObservation = "human-observation"
}

public struct ArtifactDigest: Codable, Equatable, Sendable {
    public let path: String
    public let sha256: String
}

public struct TrialTerminal: Codable, Equatable, Sendable {
    public let status: String
    public let endedAt: Date
    public let artifacts: [ArtifactDigest]
    public let message: String?

    public init(status: String, endedAt: Date = Date(), artifacts: [ArtifactDigest], message: String? = nil) {
        self.status = status
        self.endedAt = endedAt
        self.artifacts = artifacts
        self.message = message
    }
}

public struct ArtifactVerification: Codable, Equatable, Sendable {
    public let valid: Bool
    public let missing: [String]
    public let changed: [String]

    public init(valid: Bool, missing: [String], changed: [String]) {
        self.valid = valid
        self.missing = missing
        self.changed = changed
    }
}

private struct AppJournalTerminal: Codable {
    let eventPath: String
    let sha256: String
}

public final class TrialStore: @unchecked Sendable {
    public let directory: URL
    private let encoder: JSONEncoder

    public init(directory: URL) throws {
        self.directory = directory
        self.encoder = JSONEncoder()
        self.encoder.dateEncodingStrategy = .iso8601
        self.encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    public func write<T: Encodable>(_ value: T, named name: String) throws {
        let destination = self.directory.appendingPathComponent(name)
        try self.encoder.encode(value).write(to: destination, options: .atomic)
    }

    public func appendJSONLine<T: Encodable>(_ value: T, named name: String) throws {
        let lineEncoder = JSONEncoder()
        lineEncoder.dateEncodingStrategy = .iso8601
        lineEncoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        var data = try lineEncoder.encode(value)
        data.append(0x0A)
        let destination = self.directory.appendingPathComponent(name)
        if !FileManager.default.fileExists(atPath: destination.path) {
            FileManager.default.createFile(atPath: destination.path, contents: nil)
        }
        let handle = try FileHandle(forWritingTo: destination)
        defer { try? handle.close() }
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
    }

    public func digest(named name: String) throws -> ArtifactDigest {
        let data = try Data(contentsOf: self.directory.appendingPathComponent(name))
        return ArtifactDigest(path: name, sha256: SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined())
    }

    public func artifactDigests(excluding excludedNames: Set<String> = ["terminal.json"]) throws -> [ArtifactDigest] {
        let names = try FileManager.default.contentsOfDirectory(
            at: self.directory,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: [.skipsHiddenFiles])
            .filter { url in
                !excludedNames.contains(url.lastPathComponent)
                    && (try? url.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
            }
            .map(\.lastPathComponent)
            .sorted()
        return try names.map(self.digest(named:))
    }

    public func verifyTerminal() throws -> ArtifactVerification {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let terminal = try decoder.decode(
            TrialTerminal.self,
            from: Data(contentsOf: self.directory.appendingPathComponent("terminal.json")))
        var missing: [String] = []
        var changed: [String] = []
        for expected in terminal.artifacts {
            let path = self.directory.appendingPathComponent(expected.path)
            guard FileManager.default.fileExists(atPath: path.path) else {
                missing.append(expected.path)
                continue
            }
            if try self.digest(named: expected.path).sha256 != expected.sha256 {
                changed.append(expected.path)
            }
        }
        let appEvents = self.directory.appendingPathComponent("app-events.jsonl")
        let appTerminal = self.directory.appendingPathComponent("app-terminal.json")
        if FileManager.default.fileExists(atPath: appEvents.path) {
            guard FileManager.default.fileExists(atPath: appTerminal.path) else {
                missing.append("app-terminal.json")
                return ArtifactVerification(valid: false, missing: missing.sorted(), changed: changed.sorted())
            }
            let app = try decoder.decode(AppJournalTerminal.self, from: Data(contentsOf: appTerminal))
            let journal = self.directory.appendingPathComponent(app.eventPath)
            guard FileManager.default.fileExists(atPath: journal.path) else {
                missing.append(app.eventPath)
                return ArtifactVerification(valid: false, missing: missing.sorted(), changed: changed.sorted())
            }
            if try self.digest(named: app.eventPath).sha256 != app.sha256 {
                changed.append(app.eventPath)
            }
        }
        return ArtifactVerification(
            valid: missing.isEmpty && changed.isEmpty,
            missing: missing.sorted(),
            changed: changed.sorted())
    }
}
