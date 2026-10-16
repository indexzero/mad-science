import Foundation

public enum TrajectoryStrategy: String, Codable, CaseIterable, Sendable {
    case humanObserved = "human-observed"
    case peekabooLinear = "peekaboo-linear"
    case peekabooHuman = "peekaboo-human"
}

public enum MotorTimingStrategy: String, Codable, CaseIterable, Sendable {
    case humanObserved = "human-observed"
    case fixedLegacy = "fixed-legacy"
    case fittsShannon = "fitts-shannon"
}

public enum CognitiveScheduleStrategy: String, Codable, CaseIterable, Sendable {
    case humanObserved = "human-observed"
    case none
    case klmGOMS = "klm-goms"
}

public struct AutomationTreatment: Codable, Equatable, Sendable {
    public let id: String
    public let family: String
    public let trajectory: TrajectoryStrategy
    public let motorTiming: MotorTimingStrategy
    public let cognitiveSchedule: CognitiveScheduleStrategy
    public let fixedMovementMilliseconds: Int?
    public let fitts: FittsLaw?
    public let klm: KLMParameters?

    public init(
        id: String,
        family: String,
        trajectory: TrajectoryStrategy,
        motorTiming: MotorTimingStrategy,
        cognitiveSchedule: CognitiveScheduleStrategy,
        fixedMovementMilliseconds: Int? = nil,
        fitts: FittsLaw? = nil,
        klm: KLMParameters? = nil)
    {
        self.id = id
        self.family = family
        self.trajectory = trajectory
        self.motorTiming = motorTiming
        self.cognitiveSchedule = cognitiveSchedule
        self.fixedMovementMilliseconds = fixedMovementMilliseconds
        self.fitts = fitts
        self.klm = klm
    }

    public var modelStatus: ModelEpistemicStatus {
        self.family == "prior-art" ? .unvalidatedMachineBaseline : .researchHypothesis
    }

    public func movementDurationSeconds(distance: Double, width: Double) throws -> Double {
        switch self.motorTiming {
        case .fixedLegacy:
            return Double(self.fixedMovementMilliseconds ?? 500) / 1_000
        case .fittsShannon:
            guard let fitts else { throw TreatmentCatalogError.incompleteTreatment(self.id) }
            return try fitts.predictSeconds(distance: distance, width: width)
        case .humanObserved:
            throw TreatmentCatalogError.incompleteTreatment(self.id)
        }
    }

    public var mentalPreparationSeconds: Double {
        self.cognitiveSchedule == .klmGOMS ? (self.klm ?? KLMParameters()).mentalPreparationSeconds : 0
    }

    public var clickSeconds: Double {
        self.cognitiveSchedule == .klmGOMS ? (self.klm ?? KLMParameters()).keystrokeSeconds : 0.06
    }
}

public enum TreatmentCatalog {
    private static let raskinFitts = FittsLaw(interceptSeconds: 0.05, slopeSecondsPerBit: 0.15)

    public static let all: [AutomationTreatment] = [
        AutomationTreatment(
            id: "peekaboo-linear",
            family: "prior-art",
            trajectory: .peekabooLinear,
            motorTiming: .fixedLegacy,
            cognitiveSchedule: .none,
            fixedMovementMilliseconds: 500),
        AutomationTreatment(
            id: "peekaboo-human",
            family: "prior-art",
            trajectory: .peekabooHuman,
            motorTiming: .fixedLegacy,
            cognitiveSchedule: .none,
            fixedMovementMilliseconds: 500),
        AutomationTreatment(
            id: "peekaboo-human-fitts",
            family: "research",
            trajectory: .peekabooHuman,
            motorTiming: .fittsShannon,
            cognitiveSchedule: .none,
            fitts: Self.raskinFitts),
        AutomationTreatment(
            id: "peekaboo-human-fitts-goms",
            family: "research",
            trajectory: .peekabooHuman,
            motorTiming: .fittsShannon,
            cognitiveSchedule: .klmGOMS,
            fitts: Self.raskinFitts,
            klm: KLMParameters()),
        AutomationTreatment(
            id: "peekaboo-linear-fitts",
            family: "research",
            trajectory: .peekabooLinear,
            motorTiming: .fittsShannon,
            cognitiveSchedule: .none,
            fitts: Self.raskinFitts),
        AutomationTreatment(
            id: "peekaboo-linear-fitts-goms",
            family: "research",
            trajectory: .peekabooLinear,
            motorTiming: .fittsShannon,
            cognitiveSchedule: .klmGOMS,
            fitts: Self.raskinFitts,
            klm: KLMParameters()),
    ]

    public static func treatment(id: String) throws -> AutomationTreatment {
        guard let treatment = self.all.first(where: { $0.id == id }) else {
            throw TreatmentCatalogError.unknownTreatment(id)
        }
        return treatment
    }
}

public enum TreatmentCatalogError: Error, Equatable {
    case unknownTreatment(String)
    case incompleteTreatment(String)
}
