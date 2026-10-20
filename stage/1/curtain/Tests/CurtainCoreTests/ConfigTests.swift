import Testing
@testable import CurtainCore

/// Tests for `Config.parse`, design section 10.
struct ConfigTests {
    @Test func defaults() {
        #expect(Config.parse(RawConfig()) == Config.defaults)
        #expect(Config.defaults.bedtime == 19 * 60 + 30)
        #expect(Config.defaults.wake == 7 * 60)
        #expect(Config.defaults.idleThresholdSeconds == 300)
        #expect(Config.defaults.chordKeyCode == 32)
        #expect(Config.defaults.chordModifiers == [.control, .option, .command])
        #expect(Config.defaults.chordHoldSeconds == 2.0)
        #expect(Config.defaults.tickSeconds == 1.0)
    }

    @Test func oneBadKeyFallsBackAlone() {
        var raw = RawConfig()
        raw.bedtime = "late"
        raw.wake = "06:00"
        let config = Config.parse(raw)
        #expect(config.bedtime == 1170)
        #expect(config.wake == 360)
    }

    @Test func modifierNames() {
        var raw = RawConfig()
        raw.chordModifiers = ["control", "OPTION", "command"]
        #expect(Config.parse(raw).chordModifiers == [.control, .option, .command])

        var bad = RawConfig()
        bad.chordModifiers = ["ctrl"]
        #expect(Config.parse(bad).chordModifiers == Config.defaults.chordModifiers)

        var shifted = RawConfig()
        shifted.chordModifiers = ["control", "option", "command", "shift"]
        #expect(Config.parse(shifted).chordModifiers == [.control, .option, .command, .shift])
    }

    @Test func tickSecondsClamps() {
        var low = RawConfig()
        low.tickSeconds = 0.1
        #expect(Config.parse(low).tickSeconds == 0.2)

        var high = RawConfig()
        high.tickSeconds = 100
        #expect(Config.parse(high).tickSeconds == 60)

        var mid = RawConfig()
        mid.tickSeconds = 1.5
        #expect(Config.parse(mid).tickSeconds == 1.5)

        #expect(Config.parse(RawConfig()).tickSeconds == 1.0)
    }
}
