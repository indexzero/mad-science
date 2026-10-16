import CoreGraphics
import Foundation
import HumanishCore

public enum PointerEventKind: String, Codable, Sendable {
    case move
    case leftDown = "left-down"
    case leftUp = "left-up"
}

public struct DriverEvent: Codable, Equatable, Sendable {
    public let kind: PointerEventKind
    public let plannedOffsetNanoseconds: UInt64
    public let emittedOffsetNanoseconds: UInt64
    public let position: Point2D

    public init(
        kind: PointerEventKind,
        plannedOffsetNanoseconds: UInt64,
        emittedOffsetNanoseconds: UInt64,
        position: Point2D)
    {
        self.kind = kind
        self.plannedOffsetNanoseconds = plannedOffsetNanoseconds
        self.emittedOffsetNanoseconds = emittedOffsetNanoseconds
        self.position = position
    }
}

@MainActor
public protocol PointerEventSink: AnyObject {
    func post(kind: PointerEventKind, at point: Point2D) throws
}

@MainActor
public final class CoreGraphicsPointerEventSink: PointerEventSink {
    public init() {}

    public func post(kind: PointerEventKind, at point: Point2D) throws {
        let eventType: CGEventType
        let button: CGMouseButton
        switch kind {
        case .move:
            eventType = .mouseMoved
            button = .left
        case .leftDown:
            eventType = .leftMouseDown
            button = .left
        case .leftUp:
            eventType = .leftMouseUp
            button = .left
        }
        guard let event = CGEvent(
            mouseEventSource: nil,
            mouseType: eventType,
            mouseCursorPosition: CGPoint(x: point.x, y: point.y),
            mouseButton: button)
        else { throw ForegroundDriverError.eventCreationFailed }
        event.post(tap: .cghidEventTap)
    }
}

public enum ForegroundDriverError: Error, Equatable {
    case eventCreationFailed
}

@MainActor
public final class ForegroundMotionPlayer {
    private let sink: any PointerEventSink
    private let uptimeNanoseconds: @Sendable () -> UInt64
    private let sleeper: @Sendable (UInt64) async throws -> Void

    public init(
        sink: any PointerEventSink,
        uptimeNanoseconds: @escaping @Sendable () -> UInt64 = { DispatchTime.now().uptimeNanoseconds },
        sleeper: @escaping @Sendable (UInt64) async throws -> Void = { try await Task.sleep(nanoseconds: $0) })
    {
        self.sink = sink
        self.uptimeNanoseconds = uptimeNanoseconds
        self.sleeper = sleeper
    }

    public func play(_ plan: MotionPlan) async throws -> [DriverEvent] {
        let start = self.uptimeNanoseconds()
        var events: [DriverEvent] = []
        for sample in plan.samples {
            let deadline = start &+ sample.offsetNanoseconds
            let now = self.uptimeNanoseconds()
            if deadline > now { try await self.sleeper(deadline - now) }
            try self.sink.post(kind: .move, at: sample.position)
            events.append(DriverEvent(
                kind: .move,
                plannedOffsetNanoseconds: sample.offsetNanoseconds,
                emittedOffsetNanoseconds: self.uptimeNanoseconds() &- start,
                position: sample.position))
        }
        return events
    }

    public func click(at point: Point2D, holdNanoseconds: UInt64 = 60_000_000) async throws -> [DriverEvent] {
        let start = self.uptimeNanoseconds()
        try self.sink.post(kind: .leftDown, at: point)
        let down = DriverEvent(
            kind: .leftDown,
            plannedOffsetNanoseconds: 0,
            emittedOffsetNanoseconds: self.uptimeNanoseconds() &- start,
            position: point)
        try await self.sleeper(holdNanoseconds)
        try self.sink.post(kind: .leftUp, at: point)
        let up = DriverEvent(
            kind: .leftUp,
            plannedOffsetNanoseconds: holdNanoseconds,
            emittedOffsetNanoseconds: self.uptimeNanoseconds() &- start,
            position: point)
        return [down, up]
    }

    public static func currentPointerLocation() -> Point2D? {
        CGEvent(source: nil).map { Point2D(x: $0.location.x, y: $0.location.y) }
    }
}
