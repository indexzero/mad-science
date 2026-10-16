import Foundation

public struct LiteratureTimingDataset: Codable, Equatable, Sendable {
    public let citationKey: String
    public let sourceURL: URL
    public let notes: String
    public let samples: [TimingSample]

    public init(citationKey: String, sourceURL: URL, notes: String, samples: [TimingSample]) {
        self.citationKey = citationKey
        self.sourceURL = sourceURL
        self.notes = notes
        self.samples = samples
    }

    public func distribution(
        distance: Double,
        width: Double,
        geometryTolerance: Double = 0.5) throws -> EmpiricalTimingDistribution
    {
        let durations = self.samples.filter {
            abs($0.distance - distance) <= geometryTolerance && abs($0.width - width) <= geometryTolerance
        }.map(\.durationSeconds)
        return try EmpiricalTimingDistribution(durations: durations)
    }
}

public struct TimingSample: Codable, Equatable, Sendable {
    public let durationSeconds: Double
    public let distance: Double
    public let width: Double
    public let participant: String?
    public let sourceRow: Int?

    public init(
        durationSeconds: Double,
        distance: Double,
        width: Double,
        participant: String? = nil,
        sourceRow: Int? = nil)
    {
        self.durationSeconds = durationSeconds
        self.distance = distance
        self.width = width
        self.participant = participant
        self.sourceRow = sourceRow
    }
}

public struct EmpiricalTimingDistribution: Codable, Equatable, Sendable {
    public let durations: [Double]

    public init(durations: [Double]) throws {
        guard !durations.isEmpty, durations.allSatisfy({ $0 >= 0 && $0.isFinite }) else {
            throw EmpiricalDistributionError.invalidSamples
        }
        self.durations = durations.sorted()
    }

    public var count: Int { self.durations.count }
    public var mean: Double { self.durations.reduce(0, +) / Double(self.count) }
    public var sampleStandardDeviation: Double? {
        guard self.count > 1 else { return nil }
        let squared = self.durations.reduce(0) { $0 + pow($1 - self.mean, 2) }
        return sqrt(squared / Double(self.count - 1))
    }
    public var median: Double { self.quantile(0.5) }

    public func quantile(_ probability: Double) -> Double {
        let p = min(1, max(0, probability))
        let position = p * Double(self.count - 1)
        let lower = Int(floor(position))
        let upper = Int(ceil(position))
        guard lower != upper else { return self.durations[lower] }
        return self.durations[lower] + (self.durations[upper] - self.durations[lower]) * (position - Double(lower))
    }

    public func compare(_ observedSeconds: Double) throws -> EmpiricalTimingComparison {
        guard observedSeconds >= 0, observedSeconds.isFinite else {
            throw EmpiricalDistributionError.invalidObservation
        }
        let rank = self.durations.partitioningIndex { $0 > observedSeconds }
        let percentile = Double(rank) / Double(self.count)
        return EmpiricalTimingComparison(
            observedSeconds: observedSeconds,
            referenceCount: self.count,
            referenceMeanSeconds: self.mean,
            referenceMedianSeconds: self.median,
            referenceP05Seconds: self.quantile(0.05),
            referenceP95Seconds: self.quantile(0.95),
            empiricalPercentile: percentile,
            withinCentral90Percent: percentile >= 0.05 && percentile <= 0.95)
    }
}

public struct EmpiricalTimingComparison: Codable, Equatable, Sendable {
    public let observedSeconds: Double
    public let referenceCount: Int
    public let referenceMeanSeconds: Double
    public let referenceMedianSeconds: Double
    public let referenceP05Seconds: Double
    public let referenceP95Seconds: Double
    public let empiricalPercentile: Double
    public let withinCentral90Percent: Bool
}

public enum EmpiricalDistributionError: Error, Equatable {
    case invalidSamples
    case invalidObservation
}

private extension Array where Element == Double {
    func partitioningIndex(where predicate: (Double) -> Bool) -> Int {
        var low = 0
        var high = self.count
        while low < high {
            let middle = (low + high) / 2
            if predicate(self[middle]) { high = middle } else { low = middle + 1 }
        }
        return low
    }
}
