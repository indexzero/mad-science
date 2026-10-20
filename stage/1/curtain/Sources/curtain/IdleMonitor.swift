import CoreGraphics

/// The HID idle counter. Design section 5.4, "Idle".
@MainActor
enum IdleMonitor {
    /// `kCGAnyInputEventType` is the C macro `((CGEventType)(~0))`. The
    /// macro is not imported into Swift, so the executable builds the
    /// value here. The imported C enum accepts any raw value, so this
    /// force unwrap cannot fail. It is the one permitted force unwrap
    /// outside `main.swift` (design section 5 and section 5.4, "Idle").
    private static let anyInput = CGEventType(rawValue: ~0)!

    /// Seconds since the last input event in the HID system state. A
    /// display assertion does not reset this counter.
    static func idleSeconds() -> Double {
        CGEventSource.secondsSinceLastEventType(.hidSystemState, eventType: anyInput)
    }
}
