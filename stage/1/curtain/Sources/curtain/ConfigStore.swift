import Foundation
import CurtainCore

/// Reads the `family.curtain` defaults domain on every tick and parses it
/// with `Config.parse`. Design sections 5.4 and 7. The parse is pure and
/// has no log channel, so this type compares the raw values to the parsed
/// result and logs each fallback once per key per change.
@MainActor
final class ConfigStore {
    private let defaults: UserDefaults?
    private var loggedMissingSuite = false
    private var loggedBedtimeEqualsWake = false
    /// The raw text last logged as a fallback, per key. A key is removed
    /// when its value parses again, so a later bad value logs again.
    private var loggedFallbacks: [String: String] = [:]

    /// Open the suite. `UserDefaults(suiteName:)` returns nil for a few
    /// reserved names. The store then serves `Config.defaults`.
    init(suiteName: String = "family.curtain") {
        defaults = UserDefaults(suiteName: suiteName)
    }

    /// Build a `RawConfig` from the typed reads of design section 7, then
    /// parse. When the suite is nil, return `Config.defaults` and log once.
    func read() -> Config {
        guard let defaults else {
            if !loggedMissingSuite {
                log("config: UserDefaults suite is nil, using defaults")
                loggedMissingSuite = true
            }
            return Config.defaults
        }
        var raw = RawConfig()
        raw.bedtime = defaults.string(forKey: "bedtime")
        raw.wake = defaults.string(forKey: "wake")
        raw.idleThresholdSeconds = defaults.object(forKey: "idleThresholdSeconds") as? Double
        raw.chordKeyCode = defaults.object(forKey: "chordKeyCode") as? Int
        raw.chordModifiers = defaults.stringArray(forKey: "chordModifiers")
        raw.chordHoldSeconds = defaults.object(forKey: "chordHoldSeconds") as? Double
        raw.tickSeconds = defaults.object(forKey: "tickSeconds") as? Double
        let config = Config.parse(raw)
        logFallbacks(raw: raw, defaults: defaults)
        logBedtimeEqualsWake(config)
        return config
    }

    /// Compare each raw value to the parse rule of its key. A key that is
    /// present and does not parse has fallen back to its default.
    private func logFallbacks(raw: RawConfig, defaults: UserDefaults) {
        check("bedtime", present: defaults.object(forKey: "bedtime"), parsed: raw.bedtime.flatMap(Schedule.parseHHMM))
        check("wake", present: defaults.object(forKey: "wake"), parsed: raw.wake.flatMap(Schedule.parseHHMM))
        check("idleThresholdSeconds", present: defaults.object(forKey: "idleThresholdSeconds"),
              parsed: raw.idleThresholdSeconds.flatMap(Self.wellFormedSeconds))
        check("chordKeyCode", present: defaults.object(forKey: "chordKeyCode"), parsed: raw.chordKeyCode)
        check("chordModifiers", present: defaults.object(forKey: "chordModifiers"),
              parsed: raw.chordModifiers.flatMap(Self.wellFormedModifiers))
        check("chordHoldSeconds", present: defaults.object(forKey: "chordHoldSeconds"),
              parsed: raw.chordHoldSeconds.flatMap(Self.wellFormedSeconds))
        check("tickSeconds", present: defaults.object(forKey: "tickSeconds"),
              parsed: raw.tickSeconds.flatMap { $0.isFinite ? $0 : nil })
    }

    /// Log once per key per change. `present` is the stored object, nil
    /// when the key is absent. `parsed` is nil when the value fell back.
    private func check(_ key: String, present: Any?, parsed: (some Any)?) {
        guard let present else {
            loggedFallbacks[key] = nil
            return
        }
        guard parsed == nil else {
            loggedFallbacks[key] = nil
            return
        }
        let text = String(describing: present)
        if loggedFallbacks[key] != text {
            log("config: \(key) is malformed (\(text)), using the default")
            loggedFallbacks[key] = text
        }
    }

    /// Design section 16: logged once at config read.
    private func logBedtimeEqualsWake(_ config: Config) {
        if config.bedtime == config.wake {
            if !loggedBedtimeEqualsWake {
                log("bedtime equals wake: bedtime disabled")
                loggedBedtimeEqualsWake = true
            }
        } else {
            loggedBedtimeEqualsWake = false
        }
    }

    /// The seconds rule of `Config.parse`: finite and not negative.
    private static func wellFormedSeconds(_ value: Double) -> Double? {
        value.isFinite && value >= 0 ? value : nil
    }

    /// The modifier rule of `Config.parse`: non-empty, every name known.
    private static func wellFormedModifiers(_ names: [String]) -> ChordModifiers? {
        guard !names.isEmpty else { return nil }
        var result = ChordModifiers()
        for name in names {
            guard let modifier = ChordModifiers.named(name) else { return nil }
            result.insert(modifier)
        }
        return result
    }
}
