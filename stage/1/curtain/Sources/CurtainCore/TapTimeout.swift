import Foundation

/// The debug escape hatch. Design section 8, layer 1.
/// A debug build drops the tap `debugLimit` seconds after install.
/// A release build never drops it: `isDebug` is false.
/// This type is pure. The executable passes the `#if DEBUG` value.
public enum TapTimeout {
    /// 60 seconds.
    public static let debugLimit: TimeInterval = 60

    /// true only in debug when now - startedAt >= limit. The boundary is inclusive.
    public static func shouldDrop(startedAt: Date, now: Date, limit: TimeInterval, isDebug: Bool) -> Bool {
        guard isDebug else { return false }
        return now.timeIntervalSince(startedAt) >= limit
    }
}
