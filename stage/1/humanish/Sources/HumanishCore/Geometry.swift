import Foundation

public struct Point2D: Codable, Equatable, Sendable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }

    public func distance(to other: Self) -> Double {
        hypot(other.x - self.x, other.y - self.y)
    }
}

public struct Rect2D: Codable, Equatable, Sendable {
    public var x: Double
    public var y: Double
    public var width: Double
    public var height: Double

    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public var center: Point2D {
        Point2D(x: self.x + self.width / 2, y: self.y + self.height / 2)
    }

    public var conservativeTargetWidth: Double {
        min(self.width, self.height)
    }
}
