/// The parsed configuration. Every field has a default. Design section 7.
public struct Config: Sendable, Equatable {
    /// Minutes past midnight. Default 19 * 60 + 30.
    public var bedtime: Int
    /// Minutes past midnight. Default 7 * 60.
    public var wake: Int
    /// Default 300.
    public var idleThresholdSeconds: Double
    /// Default 32 (kVK_ANSI_U).
    public var chordKeyCode: Int64
    /// Default [.control, .option, .command].
    public var chordModifiers: ChordModifiers
    /// Default 2.0.
    public var chordHoldSeconds: Double
    /// Default 1.0. Clamped to 0.2...60 after parse.
    public var tickSeconds: Double

    /// The default configuration.
    public static let defaults = Config(
        bedtime: 19 * 60 + 30,
        wake: 7 * 60,
        idleThresholdSeconds: 300,
        chordKeyCode: 32,
        chordModifiers: [.control, .option, .command],
        chordHoldSeconds: 2.0,
        tickSeconds: 1.0)

    /// The range that `tickSeconds` is clamped to.
    public static let tickRange: ClosedRange<Double> = 0.2...60

    /// Pure parse of raw values read from UserDefaults. A missing or
    /// malformed value falls back to the default for that key alone.
    /// `tickSeconds` is parsed, then clamped to 0.2...60.
    public static func parse(_ raw: RawConfig) -> Config {
        var config = defaults
        if let bedtime = raw.bedtime.flatMap(Schedule.parseHHMM) {
            config.bedtime = bedtime
        }
        if let wake = raw.wake.flatMap(Schedule.parseHHMM) {
            config.wake = wake
        }
        if let idle = raw.idleThresholdSeconds, isWellFormedSeconds(idle) {
            config.idleThresholdSeconds = idle
        }
        if let keyCode = raw.chordKeyCode {
            config.chordKeyCode = Int64(keyCode)
        }
        if let modifiers = raw.chordModifiers.flatMap(parseModifiers) {
            config.chordModifiers = modifiers
        }
        if let hold = raw.chordHoldSeconds, isWellFormedSeconds(hold) {
            config.chordHoldSeconds = hold
        }
        if let tick = raw.tickSeconds, isWellFormedSeconds(tick) {
            config.tickSeconds = min(max(tick, tickRange.lowerBound), tickRange.upperBound)
        }
        return config
    }

    /// Every name must parse with `ChordModifiers.named`. An empty list or
    /// one unknown name makes the whole value malformed, so the default holds.
    static func parseModifiers(_ names: [String]) -> ChordModifiers? {
        guard !names.isEmpty else { return nil }
        var result = ChordModifiers()
        for name in names {
            guard let modifier = ChordModifiers.named(name) else { return nil }
            result.insert(modifier)
        }
        return result
    }

    /// A seconds value is well formed when it is finite and not negative.
    static func isWellFormedSeconds(_ value: Double) -> Bool {
        value.isFinite && value >= 0
    }
}

/// The raw values read from UserDefaults before parse. nil means absent.
public struct RawConfig: Sendable, Equatable {
    /// "HH:MM" text.
    public var bedtime: String?
    /// "HH:MM" text.
    public var wake: String?
    public var idleThresholdSeconds: Double?
    public var chordKeyCode: Int?
    /// Modifier names, see `ChordModifiers.named`.
    public var chordModifiers: [String]?
    public var chordHoldSeconds: Double?
    public var tickSeconds: Double?

    /// Make an empty raw configuration. Every field is nil.
    public init() {}
}
