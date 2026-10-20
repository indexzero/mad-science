import Foundation
import Testing
@testable import CurtainCore

/// Tests for `TapTimeout`, design section 10. The escape hatch of section 8.
struct TapTimeoutTests {
    static let started = Date(timeIntervalSinceReferenceDate: 1_000_000)

    @Test func debugAt59() {
        let now = Self.started.addingTimeInterval(59)
        #expect(TapTimeout.shouldDrop(startedAt: Self.started, now: now, limit: 60, isDebug: true) == false)
    }

    @Test func debugAt61() {
        let now = Self.started.addingTimeInterval(61)
        #expect(TapTimeout.shouldDrop(startedAt: Self.started, now: now, limit: 60, isDebug: true) == true)
    }

    @Test func debugAt60() {
        let now = Self.started.addingTimeInterval(60)
        #expect(TapTimeout.shouldDrop(startedAt: Self.started, now: now, limit: 60, isDebug: true) == true)
    }

    @Test func releaseNever() {
        let soon = Self.started.addingTimeInterval(61)
        let late = Self.started.addingTimeInterval(3600)
        #expect(TapTimeout.shouldDrop(startedAt: Self.started, now: soon, limit: 60, isDebug: false) == false)
        #expect(TapTimeout.shouldDrop(startedAt: Self.started, now: late, limit: 60, isDebug: false) == false)
    }

    @Test func debugLimitIsSixtySeconds() {
        #expect(TapTimeout.debugLimit == 60)
    }
}
