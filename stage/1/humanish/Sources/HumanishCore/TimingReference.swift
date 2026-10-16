import Foundation

public struct TimingReference: Codable, Equatable, Sendable {
    public let citationKey: String
    public let task: String
    public let meanSeconds: Double
    public let standardDeviationSeconds: Double
    public let sampleSize: Int?

    public init(
        citationKey: String,
        task: String,
        meanSeconds: Double,
        standardDeviationSeconds: Double,
        sampleSize: Int? = nil)
    {
        self.citationKey = citationKey
        self.task = task
        self.meanSeconds = meanSeconds
        self.standardDeviationSeconds = standardDeviationSeconds
        self.sampleSize = sampleSize
    }

    public func compare(observedSeconds: Double) throws -> TimingComparison {
        guard self.standardDeviationSeconds > 0, observedSeconds.isFinite else {
            throw TimingReferenceError.invalidReference
        }
        let z = (observedSeconds - self.meanSeconds) / self.standardDeviationSeconds
        return TimingComparison(
            observedSeconds: observedSeconds,
            zScore: z,
            withinOneStandardDeviation: abs(z) <= 1,
            withinTwoStandardDeviations: abs(z) <= 2)
    }
}

public struct TimingComparison: Codable, Equatable, Sendable {
    public let observedSeconds: Double
    public let zScore: Double
    public let withinOneStandardDeviation: Bool
    public let withinTwoStandardDeviations: Bool
}

public enum TimingReferenceError: Error, Equatable {
    case invalidReference
}
