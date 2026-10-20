import Foundation
import Testing
@testable import CurtainCore

/// Tests for `Schedule`, design section 10.
struct ScheduleTests {
    /// The calendar and time zone that every date test uses.
    private static let newYork: TimeZone = {
        guard let zone = TimeZone(identifier: "America/New_York") else {
            fatalError("America/New_York is not a known time zone")
        }
        return zone
    }()

    private static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = newYork
        return calendar
    }

    /// Build a local date in America/New_York from components.
    private static func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int, _ minute: Int) throws -> Date {
        let components = DateComponents(
            calendar: calendar, timeZone: newYork,
            year: year, month: month, day: day, hour: hour, minute: minute)
        return try #require(calendar.date(from: components))
    }

    @Test func awakeDefaults() {
        #expect(Schedule.awake(now: 420, wake: 420, bed: 1170) == true)
        #expect(Schedule.awake(now: 1169, wake: 420, bed: 1170) == true)
        #expect(Schedule.awake(now: 1170, wake: 420, bed: 1170) == false)
        #expect(Schedule.awake(now: 419, wake: 420, bed: 1170) == false)
        #expect(Schedule.awake(now: 0, wake: 420, bed: 1170) == false)
    }

    @Test func awakeBedtimePastMidnight() {
        #expect(Schedule.awake(now: 1439, wake: 420, bed: 60) == true)
        #expect(Schedule.awake(now: 0, wake: 420, bed: 60) == true)
        #expect(Schedule.awake(now: 59, wake: 420, bed: 60) == true)
        #expect(Schedule.awake(now: 60, wake: 420, bed: 60) == false)
        #expect(Schedule.awake(now: 419, wake: 420, bed: 60) == false)
        #expect(Schedule.awake(now: 420, wake: 420, bed: 60) == true)
    }

    @Test func awakeEqualDisables() {
        for minute in 0..<1440 {
            #expect(Schedule.awake(now: minute, wake: 600, bed: 600) == true, "minute \(minute)")
        }
    }

    @Test func awakeWrapsNow() {
        // 1440 behaves as 0. With defaults, 0 is not awake.
        #expect(Schedule.awake(now: 1440, wake: 420, bed: 1170) == Schedule.awake(now: 0, wake: 420, bed: 1170))
        #expect(Schedule.awake(now: 1440, wake: 420, bed: 1170) == false)
        // -1 behaves as 1439. With bed 60, 1439 is awake.
        #expect(Schedule.awake(now: -1, wake: 420, bed: 60) == Schedule.awake(now: 1439, wake: 420, bed: 60))
        #expect(Schedule.awake(now: -1, wake: 420, bed: 60) == true)
        // A window that contains 1439 but not 0 separates the two wraps.
        #expect(Schedule.awake(now: 1440, wake: 1400, bed: 1439) == false)
        #expect(Schedule.awake(now: -1, wake: 1400, bed: 1439) == false)
    }

    @Test func minutesPastMidnightSpringForward() throws {
        // 2026-03-08 is the spring forward day in America/New_York. It has 23 hours.
        let halfPastThree = try Self.date(2026, 3, 8, 3, 30)
        #expect(Schedule.minutesPastMidnight(halfPastThree, calendar: Self.calendar) == 210)

        let midnight = try Self.date(2026, 3, 8, 0, 0)
        let nextMidnight = midnight.addingTimeInterval(23 * 3600)
        #expect(Schedule.minutesPastMidnight(nextMidnight, calendar: Self.calendar) == 0)
        let day = Self.calendar.component(.day, from: nextMidnight)
        #expect(day == 9)
    }

    @Test func minutesPastMidnightFallBack() throws {
        // 2026-11-01 is the fall back day in America/New_York. It has 25 hours.
        let halfPastOne = try Self.date(2026, 11, 1, 1, 30)
        #expect(Schedule.minutesPastMidnight(halfPastOne, calendar: Self.calendar) == 90)

        let midnight = try Self.date(2026, 11, 1, 0, 0)
        let nextMidnight = midnight.addingTimeInterval(25 * 3600)
        #expect(Schedule.minutesPastMidnight(nextMidnight, calendar: Self.calendar) == 0)
        let day = Self.calendar.component(.day, from: nextMidnight)
        #expect(day == 2)
    }

    @Test func awakeAcrossDST() throws {
        let defaults = Config.defaults
        let seven = try Self.date(2026, 3, 8, 7, 0)
        let sevenMinutes = Schedule.minutesPastMidnight(seven, calendar: Self.calendar)
        #expect(Schedule.awake(now: sevenMinutes, wake: defaults.wake, bed: defaults.bedtime) == true)

        let beforeSeven = try Self.date(2026, 3, 8, 6, 59)
        let beforeSevenMinutes = Schedule.minutesPastMidnight(beforeSeven, calendar: Self.calendar)
        #expect(Schedule.awake(now: beforeSevenMinutes, wake: defaults.wake, bed: defaults.bedtime) == false)
    }

    @Test func parseHHMM() {
        #expect(Schedule.parseHHMM("07:00") == 420)
        #expect(Schedule.parseHHMM("7:05") == 425)
        #expect(Schedule.parseHHMM("19:30") == 1170)
        #expect(Schedule.parseHHMM("24:00") == nil)
        #expect(Schedule.parseHHMM("7") == nil)
        #expect(Schedule.parseHHMM("07:60") == nil)
        #expect(Schedule.parseHHMM("") == nil)
    }
}
