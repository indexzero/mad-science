/// The per-tick tap rule. Design section 5.5, "Lifecycle", and the
/// escape hatch of section 8, layer 1. The rule runs on every tick,
/// whether the curtain is up or down. A curtain can drop without a
/// chord: `screensChanged()` drops it and `raise()` returns with no
/// windows when the screen list is empty. The tap must not survive
/// that drop, and the debug timeout must not depend on `isUp`.
/// This type is pure. The executable applies the action.
public enum TapLifecycle: Sendable {
    /// What the executable does with the tap on this tick.
    public enum Action: Sendable, Equatable {
        /// Leave the tap as it is.
        case none
        /// Call `install()`. The curtain is up and no timeout holds.
        case install
        /// Call `uninstall()`. The curtain is down and the tap is still up.
        case uninstallCurtainDown
        /// Call `uninstall()`. The debug timeout fired while up.
        case uninstallTimeout
    }

    /// The action and the new value of the timed-out flag.
    public struct Decision: Sendable, Equatable {
        public var action: Action
        /// true only after `uninstallTimeout`, until the curtain drops.
        public var timedOut: Bool

        public init(action: Action, timedOut: Bool) {
            self.action = action
            self.timedOut = timedOut
        }
    }

    /// Decide for one tick.
    /// - `curtainUp`: `CurtainController.isUp`.
    /// - `tapInstalled`: `InputTap.isInstalled`.
    /// - `timedOut`: the flag carried between ticks.
    /// - `shouldDrop`: `TapTimeout.shouldDrop` on `startedAt`, false when nil.
    ///
    /// Down: uninstall when installed, and clear the flag in every case.
    /// Up and installed: drop on `shouldDrop`, else keep.
    /// Up and not installed: install unless the flag is set.
    public static func decide(curtainUp: Bool, tapInstalled: Bool, timedOut: Bool, shouldDrop: Bool) -> Decision {
        guard curtainUp else {
            return Decision(action: tapInstalled ? .uninstallCurtainDown : .none, timedOut: false)
        }
        if tapInstalled {
            if shouldDrop { return Decision(action: .uninstallTimeout, timedOut: true) }
            return Decision(action: .none, timedOut: timedOut)
        }
        return Decision(action: timedOut ? .none : .install, timedOut: timedOut)
    }
}
