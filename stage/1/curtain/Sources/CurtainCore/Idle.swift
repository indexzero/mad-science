/// Idle time rules.
public enum Idle {
    /// true when idleSeconds >= threshold.
    public static func shouldRaise(idleSeconds: Double, threshold: Double) -> Bool {
        idleSeconds >= threshold
    }

    /// The idle time the tick feeds to `shouldRaise`. `hidIdle` is the HID
    /// counter. `sinceDrop` is seconds since the chord last dropped the
    /// curtain, nil before any drop. Returns `min(hidIdle, sinceDrop)` when
    /// `sinceDrop` is set, else `hidIdle`. A chord drop counts as activity.
    public static func effectiveIdle(hidIdle: Double, sinceDrop: Double?) -> Double {
        guard let sinceDrop else { return hidIdle }
        return min(hidIdle, sinceDrop)
    }
}
