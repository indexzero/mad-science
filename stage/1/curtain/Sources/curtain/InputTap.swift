import ApplicationServices
import CoreGraphics
import Foundation
import CurtainCore

/// A Sendable snapshot of one CGEvent. Built inside the C callback,
/// outside the actor. `CGEvent` is not Sendable, so every needed field
/// is read here before the actor is entered (design section 6).
struct TapEvent: Sendable {
    /// true for `.tapDisabledByTimeout` and `.tapDisabledByUserInput`.
    var tapDisabled: Bool
    /// The chord event. nil unless the type is keyDown or keyUp.
    var chord: ChordEvent?

    /// Read the fields of design section 5.5, "The callback".
    init(type: CGEventType, event: CGEvent) {
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            tapDisabled = true
            chord = nil
        case .keyDown, .keyUp:
            tapDisabled = false
            var modifiers = ChordModifiers()
            let flags = event.flags
            if flags.contains(.maskControl) { modifiers.insert(.control) }
            if flags.contains(.maskAlternate) { modifiers.insert(.option) }
            if flags.contains(.maskCommand) { modifiers.insert(.command) }
            if flags.contains(.maskShift) { modifiers.insert(.shift) }
            chord = ChordEvent(
                kind: type == .keyUp ? .keyUp : .keyDown,
                timestamp: Double(event.timestamp) / 1e9,
                keyCode: event.getIntegerValueField(.keyboardEventKeycode),
                modifiers: modifiers,
                isRepeat: type == .keyDown && event.getIntegerValueField(.keyboardEventAutorepeat) != 0)
        default:
            tapDisabled = false
            chord = nil
        }
    }
}

/// The C callback of the tap. A global function with no captures, so it
/// converts to `CGEventTapCallBack`. The `InputTap` travels through
/// `refcon` as an unretained pointer (design section 6). The tap source
/// is on the main run loop, so the callback runs on the main thread and
/// `MainActor.assumeIsolated` holds. Every event is deleted: the callback
/// returns nil whenever `handle` returns true, and `handle` always does.
private func curtainTapCallback(
    proxy: CGEventTapProxy,
    type: CGEventType,
    event: CGEvent,
    refcon: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    guard let refcon else { return nil }
    let tap = Unmanaged<InputTap>.fromOpaque(refcon).takeUnretainedValue()
    let snapshot = TapEvent(type: type, event: event)
    let swallow = MainActor.assumeIsolated { tap.handle(snapshot) }
    return swallow ? nil : Unmanaged.passUnretained(event)
}

/// The HID event tap. Design section 5.5. Installed when the curtain
/// rises, uninstalled when it drops. Owned by `AppDelegate` for the life
/// of the process, so the unretained `refcon` cannot dangle.
@MainActor
final class InputTap {
    /// The tap port. nil while not installed.
    private(set) var port: CFMachPort?
    private var source: CFRunLoopSource?
    /// The install time, for `TapTimeout`. nil while not installed.
    private(set) var startedAt: Date?
    /// true while the tap exists.
    var isInstalled: Bool { port != nil }
    /// The tap feed. Set by `AppDelegate` to `handleChord`.
    var onChord: (ChordEvent) -> Void = { _ in }

    /// true after the first Accessibility check of the process.
    private var promptShown = false
    /// true after the unavailable line was logged. Reset on install.
    private var loggedUnavailable = false

    /// The Accessibility check of design section 5.5. The system prompt
    /// is requested on the first call of the process and not after. The
    /// key is the string literal. Swift 6 rejects the AX global constant
    /// for that key as shared mutable state (design section 6).
    @discardableResult
    func checkTrust() -> Bool {
        let key = "AXTrustedCheckOptionPrompt" as CFString
        let options = [key: !promptShown] as CFDictionary
        promptShown = true
        return AXIsProcessTrustedWithOptions(options)
    }

    /// Try `.cghidEventTap`, then `.cgSessionEventTap`. Return false when
    /// both are nil. Never crash. Log the location that succeeded, or the
    /// failure once per state change.
    @discardableResult
    func install(now: Date = Date()) -> Bool {
        if port != nil { return true }
        checkTrust()
        let refcon = Unmanaged.passUnretained(self).toOpaque()
        let mask: CGEventMask = ~CGEventMask(0)
        let locations: [(CGEventTapLocation, String)] = [
            (.cghidEventTap, "HID"), (.cgSessionEventTap, "session"),
        ]
        var created: CFMachPort?
        var name = ""
        for (location, label) in locations {
            created = CGEvent.tapCreate(
                tap: location, place: .headInsertEventTap, options: .defaultTap,
                eventsOfInterest: mask, callback: curtainTapCallback, userInfo: refcon)
            if created != nil {
                name = label
                break
            }
        }
        guard let created else {
            if !loggedUnavailable {
                log("tap unavailable: grant Accessibility (and Input Monitoring) to curtain")
                loggedUnavailable = true
            }
            return false
        }
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, created, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: created, enable: true)
        port = created
        self.source = source
        startedAt = now
        loggedUnavailable = false
        log("tap installed at \(name)")
        return true
    }

    /// Invalidate the port, remove the source from the main run loop,
    /// clear the state, log. Idempotent.
    func uninstall() {
        guard let port else { return }
        CGEvent.tapEnable(tap: port, enable: false)
        if let source {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes)
        }
        CFMachPortInvalidate(port)
        self.port = nil
        source = nil
        startedAt = nil
        log("tap uninstalled")
    }

    /// Called on the main actor from the C callback. Returns true to
    /// swallow. Always true in this project. A system disable re-enables
    /// the tap. keyDown and keyUp feed `onChord`.
    func handle(_ event: TapEvent) -> Bool {
        if event.tapDisabled {
            if let port {
                CGEvent.tapEnable(tap: port, enable: true)
                log("tap re-enabled after a system disable")
            }
            return true
        }
        if let chord = event.chord {
            onChord(chord)
        }
        return true
    }
}
