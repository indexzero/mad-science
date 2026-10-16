import Foundation

public struct TimedPoint: Codable, Equatable, Sendable {
    public let offsetNanoseconds: UInt64
    public let position: Point2D

    public init(offsetNanoseconds: UInt64, position: Point2D) {
        self.offsetNanoseconds = offsetNanoseconds
        self.position = position
    }
}

public struct MotionPlan: Codable, Equatable, Sendable {
    public let model: String
    public let predictedSeconds: Double
    public let distance: Double
    public let targetWidth: Double
    public let samples: [TimedPoint]

    public init(
        model: String,
        predictedSeconds: Double,
        distance: Double,
        targetWidth: Double,
        samples: [TimedPoint]) throws
    {
        guard predictedSeconds >= 0, predictedSeconds.isFinite else { throw ModelError.invalidDuration }
        guard samples.first?.offsetNanoseconds == 0,
              zip(samples, samples.dropFirst()).allSatisfy({ $0.offsetNanoseconds <= $1.offsetNanoseconds })
        else { throw MotionPlanError.nonMonotonicSamples }
        self.model = model
        self.predictedSeconds = predictedSeconds
        self.distance = distance
        self.targetWidth = targetWidth
        self.samples = samples
    }
}

public enum MotionPlanError: Error, Equatable {
    case nonMonotonicSamples
}

/// A deterministic minimum-jerk baseline. It is an executable motor hypothesis,
/// not a claim that human pointer motion is universally minimum-jerk.
public struct MinimumJerkPlanner: Codable, Equatable, Sendable {
    public var fitts: FittsLaw
    public var sampleRateHz: Double

    public init(fitts: FittsLaw, sampleRateHz: Double = 120) {
        self.fitts = fitts
        self.sampleRateHz = sampleRateHz
    }

    public func plan(from start: Point2D, to end: Point2D, targetWidth: Double) throws -> MotionPlan {
        guard self.sampleRateHz > 0, self.sampleRateHz.isFinite else { throw ModelError.invalidSampleRate }
        let distance = start.distance(to: end)
        let seconds = try self.fitts.predictSeconds(distance: distance, width: targetWidth)
        let intervals = max(1, Int(ceil(seconds * self.sampleRateHz)))
        let samples = (0...intervals).map { index -> TimedPoint in
            let t = Double(index) / Double(intervals)
            let progress = 10 * pow(t, 3) - 15 * pow(t, 4) + 6 * pow(t, 5)
            return TimedPoint(
                offsetNanoseconds: UInt64((seconds * t * 1_000_000_000).rounded()),
                position: Point2D(
                    x: start.x + (end.x - start.x) * progress,
                    y: start.y + (end.y - start.y) * progress))
        }
        return try MotionPlan(
            model: "minimum-jerk+shannon-fitts",
            predictedSeconds: seconds,
            distance: distance,
            targetWidth: targetWidth,
            samples: samples)
    }
}
