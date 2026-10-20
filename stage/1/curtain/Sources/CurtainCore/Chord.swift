/// The four tracked modifier keys.
public struct ChordModifiers: OptionSet, Sendable, Hashable {
    public let rawValue: UInt8
    /// Make a set from its raw bits.
    public init(rawValue: UInt8) { self.rawValue = rawValue }
    public static let control = ChordModifiers(rawValue: 1 << 0)
    public static let option  = ChordModifiers(rawValue: 1 << 1)
    public static let command = ChordModifiers(rawValue: 1 << 2)
    public static let shift   = ChordModifiers(rawValue: 1 << 3)

    /// "control" "option" "command" "shift" (case-insensitive). nil on any other name.
    public static func named(_ name: String) -> ChordModifiers? {
        switch name.lowercased() {
        case "control": return .control
        case "option": return .option
        case "command": return .command
        case "shift": return .shift
        default: return nil
        }
    }
}

/// One key event as the detector sees it.
public struct ChordEvent: Sendable, Equatable {
    /// keyDown or keyUp.
    public enum Kind: Sendable { case keyDown, keyUp }
    public var kind: Kind
    /// Seconds of system uptime in production. Tests use any one origin.
    public var timestamp: Double
    public var keyCode: Int64
    public var modifiers: ChordModifiers
    /// true for an autorepeat keyDown.
    public var isRepeat: Bool

    /// Make one key event.
    public init(kind: Kind, timestamp: Double, keyCode: Int64, modifiers: ChordModifiers, isRepeat: Bool) {
        self.kind = kind
        self.timestamp = timestamp
        self.keyCode = keyCode
        self.modifiers = modifiers
        self.isRepeat = isRepeat
    }
}

/// The result of one feed or poll.
public enum ChordVerdict: Sendable, Equatable {
    /// Nothing to do.
    case ignored
    /// The first press was seen. The hold starts.
    case armed
    /// The chord is held. `elapsed` seconds since the arm.
    case holding(elapsed: Double)
    /// The hold passed the threshold. The curtain drops.
    case fired
}

/// The chord state machine. A value type with state. Design section 5.2.
/// A keyDown matches when the key code and the exact modifier set match.
public struct ChordDetector: Sendable, Equatable {
    public var keyCode: Int64
    public var modifiers: ChordModifiers
    public var holdSeconds: Double
    /// The timestamp of the press that armed the detector. nil when not armed.
    public private(set) var armedAt: Double?

    /// Make a detector. The defaults are Control-Option-Command-U held 2.0 s.
    public init(keyCode: Int64 = 32, modifiers: ChordModifiers = [.control, .option, .command], holdSeconds: Double = 2.0) {
        self.keyCode = keyCode
        self.modifiers = modifiers
        self.holdSeconds = holdSeconds
        self.armedAt = nil
    }

    /// Feed one key event. Mutating: the detector is a value type with state.
    public mutating func feed(_ event: ChordEvent) -> ChordVerdict {
        switch event.kind {
        case .keyDown:
            let matches = event.keyCode == keyCode && event.modifiers == modifiers
            guard matches else {
                reset()
                return .ignored
            }
            guard let armedAt, event.isRepeat else {
                // First press, or a second physical press: the hold starts here.
                self.armedAt = event.timestamp
                return .armed
            }
            let elapsed = event.timestamp - armedAt
            if elapsed >= holdSeconds {
                reset()
                return .fired
            }
            return .holding(elapsed: elapsed)
        case .keyUp:
            if event.keyCode == keyCode {
                reset()
            }
            return .ignored
        }
    }

    /// Check the hold from the tick when no autorepeat arrives.
    public mutating func poll(now: Double) -> ChordVerdict {
        guard let armedAt else { return .ignored }
        let elapsed = now - armedAt
        if elapsed >= holdSeconds {
            reset()
            return .fired
        }
        return .holding(elapsed: elapsed)
    }

    /// Forget the armed press.
    public mutating func reset() {
        armedAt = nil
    }
}
