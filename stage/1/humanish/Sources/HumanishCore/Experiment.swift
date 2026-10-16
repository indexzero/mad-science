import Foundation

public enum ExperimentCondition: String, Codable, CaseIterable, Sendable {
    case human
    case computerPixels = "computer-pixels"
    case computerAccessibility = "computer-accessibility"

    public var observationPolicy: ObservationPolicy {
        switch self {
        case .human:
            ObservationPolicy(allowsPixels: true, allowsAccessibility: false, allowsDirectAppState: false)
        case .computerPixels:
            ObservationPolicy(allowsPixels: true, allowsAccessibility: false, allowsDirectAppState: false)
        case .computerAccessibility:
            ObservationPolicy(allowsPixels: true, allowsAccessibility: true, allowsDirectAppState: false)
        }
    }
}

public struct ObservationPolicy: Codable, Equatable, Sendable {
    public let allowsPixels: Bool
    public let allowsAccessibility: Bool
    public let allowsDirectAppState: Bool

    public init(allowsPixels: Bool, allowsAccessibility: Bool, allowsDirectAppState: Bool) {
        self.allowsPixels = allowsPixels
        self.allowsAccessibility = allowsAccessibility
        self.allowsDirectAppState = allowsDirectAppState
    }

    public func requireAccessibility() throws {
        guard self.allowsAccessibility else { throw ObservationPolicyError.accessibilityLeak }
    }
}

public enum ObservationPolicyError: Error, Equatable {
    case accessibilityLeak
}

public enum KLMOperatorKind: String, Codable, Sendable {
    case mentalPreparation = "M"
    case point = "P"
    case keystroke = "K"
    case homing = "H"
    case systemResponse = "R"
}

public struct KLMOperator: Codable, Equatable, Sendable {
    public let kind: KLMOperatorKind
    public let repetitions: Int
    public let responseSeconds: Double?

    public init(_ kind: KLMOperatorKind, repetitions: Int = 1, responseSeconds: Double? = nil) {
        self.kind = kind
        self.repetitions = repetitions
        self.responseSeconds = responseSeconds
    }
}

public struct KLMParameters: Codable, Equatable, Sendable {
    public var mentalPreparationSeconds: Double
    public var keystrokeSeconds: Double
    public var homingSeconds: Double

    public init(
        mentalPreparationSeconds: Double = 1.35,
        keystrokeSeconds: Double = 0.20,
        homingSeconds: Double = 0.40)
    {
        self.mentalPreparationSeconds = mentalPreparationSeconds
        self.keystrokeSeconds = keystrokeSeconds
        self.homingSeconds = homingSeconds
    }
}

public struct FittsLaw: Codable, Equatable, Sendable {
    public var interceptSeconds: Double
    public var slopeSecondsPerBit: Double

    public init(interceptSeconds: Double, slopeSecondsPerBit: Double) {
        self.interceptSeconds = interceptSeconds
        self.slopeSecondsPerBit = slopeSecondsPerBit
    }

    public func indexOfDifficulty(distance: Double, width: Double) throws -> Double {
        guard distance >= 0, width > 0, distance.isFinite, width.isFinite else {
            throw ModelError.invalidGeometry
        }
        return log2(1 + distance / width)
    }

    public func predictSeconds(distance: Double, width: Double) throws -> Double {
        max(0, self.interceptSeconds + self.slopeSecondsPerBit * (try self.indexOfDifficulty(distance: distance, width: width)))
    }
}

public struct KLMModel: Codable, Equatable, Sendable {
    public var parameters: KLMParameters
    public var pointing: FittsLaw

    public init(parameters: KLMParameters = KLMParameters(), pointing: FittsLaw) {
        self.parameters = parameters
        self.pointing = pointing
    }

    public func predictSeconds(
        operators: [KLMOperator],
        pointingDistance: Double,
        targetWidth: Double) throws -> Double
    {
        try operators.reduce(0) { total, op in
            let one: Double
            switch op.kind {
            case .mentalPreparation: one = self.parameters.mentalPreparationSeconds
            case .point: one = try self.pointing.predictSeconds(distance: pointingDistance, width: targetWidth)
            case .keystroke: one = self.parameters.keystrokeSeconds
            case .homing: one = self.parameters.homingSeconds
            case .systemResponse: one = op.responseSeconds ?? 0
            }
            return total + one * Double(max(0, op.repetitions))
        }
    }
}

public enum ModelError: Error, Equatable {
    case invalidGeometry
    case invalidDuration
    case invalidSampleRate
}
