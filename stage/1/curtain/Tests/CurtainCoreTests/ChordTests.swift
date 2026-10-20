import Testing
@testable import CurtainCore

/// Tests for `ChordDetector`, design section 10. The chord is
/// Control-Option-Command-U (key code 32) held for 2.0 seconds.
struct ChordTests {
    static let chord: ChordModifiers = [.control, .option, .command]
    static let u: Int64 = 32
    static let j: Int64 = 38

    /// A keyDown of the chord key with the chord modifiers.
    static func down(_ t: Double, key: Int64 = u, modifiers: ChordModifiers = chord, isRepeat: Bool = false) -> ChordEvent {
        ChordEvent(kind: .keyDown, timestamp: t, keyCode: key, modifiers: modifiers, isRepeat: isRepeat)
    }

    /// A keyUp of a key.
    static func up(_ t: Double, key: Int64 = u, modifiers: ChordModifiers = chord) -> ChordEvent {
        ChordEvent(kind: .keyUp, timestamp: t, keyCode: key, modifiers: modifiers, isRepeat: false)
    }

    @Test func firstPressArms() {
        var detector = ChordDetector()
        #expect(detector.feed(Self.down(0)) == .armed)
        #expect(detector.armedAt == 0)
    }

    @Test func repeatPastThresholdFires() {
        var detector = ChordDetector()
        #expect(detector.feed(Self.down(0)) == .armed)
        #expect(detector.feed(Self.down(1.0, isRepeat: true)) == .holding(elapsed: 1.0))
        #expect(detector.feed(Self.down(2.0, isRepeat: true)) == .fired)
        #expect(detector.armedAt == nil)
    }

    @Test func repeatBeforeThresholdHolds() {
        var detector = ChordDetector()
        #expect(detector.feed(Self.down(0)) == .armed)
        #expect(detector.feed(Self.down(0.5, isRepeat: true)) == .holding(elapsed: 0.5))
        #expect(detector.feed(Self.down(1.0, isRepeat: true)) == .holding(elapsed: 1.0))
        #expect(detector.feed(Self.down(1.9, isRepeat: true)) == .holding(elapsed: 1.9))
        #expect(detector.armedAt == 0)
    }

    @Test func releaseBeforeThresholdResets() {
        var detector = ChordDetector()
        #expect(detector.feed(Self.down(0)) == .armed)
        #expect(detector.feed(Self.up(1.5)) == .ignored)
        #expect(detector.armedAt == nil)
        #expect(detector.feed(Self.down(2.5, isRepeat: true)) == .armed)
        #expect(detector.armedAt == 2.5)
    }

    @Test func wrongKeyResets() {
        var detector = ChordDetector()
        #expect(detector.feed(Self.down(0)) == .armed)
        #expect(detector.feed(Self.down(0.5, key: Self.j)) == .ignored)
        #expect(detector.armedAt == nil)
        #expect(detector.feed(Self.down(2.5, isRepeat: true)) == .armed)
    }

    @Test func wrongModifiersIgnored() {
        var detector = ChordDetector()
        #expect(detector.feed(Self.down(0, modifiers: [.control])) == .ignored)
        #expect(detector.armedAt == nil)
        #expect(detector.feed(Self.down(0, modifiers: [.control, .option, .command, .shift])) == .ignored)
        #expect(detector.armedAt == nil)
    }

    @Test func secondPressRearms() {
        var detector = ChordDetector()
        #expect(detector.feed(Self.down(0)) == .armed)
        #expect(detector.feed(Self.down(1.0)) == .armed)
        #expect(detector.armedAt == 1.0)
        #expect(detector.feed(Self.down(2.5, isRepeat: true)) == .holding(elapsed: 1.5))
    }

    @Test func pollFiresWithoutRepeat() {
        var detector = ChordDetector()
        #expect(detector.feed(Self.down(0)) == .armed)
        #expect(detector.poll(now: 1.9) == .holding(elapsed: 1.9))
        #expect(detector.poll(now: 2.0) == .fired)
        #expect(detector.poll(now: 3.0) == .ignored)
    }

    @Test func otherKeyUpKeepsState() {
        var detector = ChordDetector()
        #expect(detector.feed(Self.down(0)) == .armed)
        #expect(detector.feed(Self.up(0.5, key: Self.j)) == .ignored)
        #expect(detector.armedAt == 0)
        #expect(detector.feed(Self.down(2.0, isRepeat: true)) == .fired)
    }

    @Test func modifierNamesParse() {
        #expect(ChordModifiers.named("control") == .control)
        #expect(ChordModifiers.named("Option") == .option)
        #expect(ChordModifiers.named("COMMAND") == .command)
        #expect(ChordModifiers.named("shift") == .shift)
        #expect(ChordModifiers.named("ctrl") == nil)
        #expect(ChordModifiers.named("") == nil)
    }

    /// An autorepeat with drifted modifiers is a wrong chord. It resets the
    /// detector, so a later full-chord repeat re-arms instead of firing.
    @Test func repeatWithDriftedModifiersResets() {
        var detector = ChordDetector()
        #expect(detector.feed(Self.down(0)) == .armed)
        #expect(detector.feed(Self.down(1.0, modifiers: [.control, .option], isRepeat: true)) == .ignored)
        #expect(detector.armedAt == nil)
        #expect(detector.feed(Self.down(2.5, isRepeat: true)) == .armed)
        #expect(detector.armedAt == 2.5)
    }
}
