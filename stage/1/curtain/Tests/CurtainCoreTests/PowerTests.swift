import Testing
@testable import CurtainCore

/// Tests for `Power`, design section 10.
struct PowerTests {
    @Test func pmsetArgsDefaultWake() {
        #expect(Power.pmsetArgs(wake: "07:00") == ["repeat", "wakeorpoweron", "MTWRFSU", "07:00:00"])
    }

    @Test func pmsetArgsPadsHour() {
        #expect(Power.pmsetArgs(wake: "7:30") == ["repeat", "wakeorpoweron", "MTWRFSU", "07:30:00"])
        #expect(Power.pmsetArgs(wake: "07:00:00") == ["repeat", "wakeorpoweron", "MTWRFSU", "07:00:00"])
    }

    @Test func pmsetArgsPassesBadShapeThrough() {
        #expect(Power.pmsetArgs(wake: "seven") == ["repeat", "wakeorpoweron", "MTWRFSU", "seven:00"])
    }

    @Test func displaySleepArgs() {
        #expect(Power.displaySleepArgs == ["displaysleepnow"])
    }
}
