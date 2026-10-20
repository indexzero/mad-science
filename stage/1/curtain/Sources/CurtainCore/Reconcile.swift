/// The inputs of one tick.
public struct ReconcileState: Sendable, Equatable {
    /// `Schedule.awake` for this tick.
    public var awake: Bool
    /// `Idle.shouldRaise` for this tick.
    public var idle: Bool
    /// The window is up.
    public var curtainUp: Bool
    /// The beginActivity token is held.
    public var assertionHeld: Bool

    /// Make a state from the four inputs of one tick.
    public init(awake: Bool, idle: Bool, curtainUp: Bool, assertionHeld: Bool) {
        self.awake = awake
        self.idle = idle
        self.curtainUp = curtainUp
        self.assertionHeld = assertionHeld
    }
}

/// One side effect the executable applies after a tick.
public enum ReconcileAction: Sendable, Hashable {
    /// Raise the curtain window on every display.
    case raiseCurtain
    /// Take the display assertion.
    case holdAssertion
    /// Release the display assertion.
    case releaseAssertion
    /// Run `pmset displaysleepnow`.
    case displaySleepNow
}

/// The level-triggered decision of one tick. Design section 5.1.
/// The curtain never drops from a reconcile. Only the chord drops it.
public enum Reconcile: Sendable {
    /// Decide the actions for `state`.
    /// `wantUp = curtainUp || idle`. `wantAssertion = wantUp && awake`.
    public static func decide(_ state: ReconcileState) -> Set<ReconcileAction> {
        let wantUp = state.curtainUp || state.idle
        let wantAssertion = wantUp && state.awake
        var actions = Set<ReconcileAction>()
        if state.idle && !state.curtainUp {
            actions.insert(.raiseCurtain)
        }
        if wantAssertion && !state.assertionHeld {
            actions.insert(.holdAssertion)
        }
        if !wantAssertion && state.assertionHeld {
            actions.insert(.releaseAssertion)
        }
        let transition = actions.contains(.raiseCurtain) || actions.contains(.releaseAssertion)
        if !state.awake && wantUp && transition {
            actions.insert(.displaySleepNow)
        }
        return actions
    }
}
