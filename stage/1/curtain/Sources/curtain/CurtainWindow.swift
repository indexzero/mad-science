import AppKit
import CurtainCore

/// One borderless black window per screen at screen saver level.
/// Design section 5.4. The content view is a plain NSView so a later
/// run can swap in a canvas (design section 4.3).
@MainActor
final class CurtainWindow: NSWindow {
    /// The window feed. Set by `CurtainController`, which forwards to
    /// `AppDelegate.handleChord`. Fed only when the local event monitor
    /// of `AppDelegate` is not installed (rider R-4, one path per event).
    var onChord: (ChordEvent) -> Void = { _ in }

    /// Borderless, opaque black, level .screenSaver, covers `screen.frame`,
    /// collectionBehavior [.canJoinAllSpaces, .fullScreenAuxiliary,
    /// .stationary], ignoresMouseEvents false.
    init(screen: NSScreen) {
        super.init(
            contentRect: screen.frame, styleMask: .borderless,
            backing: .buffered, defer: false)
        setFrame(screen.frame, display: false)
        level = .screenSaver
        isOpaque = true
        backgroundColor = .black
        hasShadow = false
        ignoresMouseEvents = false
        isReleasedWhenClosed = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        contentView = NSView(frame: NSRect(origin: .zero, size: screen.frame.size))
    }

    override var canBecomeKey: Bool { true }

    #if DEBUG
    /// The debug Command-Q path of design section 8. The release build
    /// has no such check and no such symbol. Shared by the window
    /// override and the local event monitor so the check is reachable on
    /// whichever path handles keyDown (rider R-4).
    static func isDebugQuit(_ event: NSEvent) -> Bool {
        event.type == .keyDown
            && event.modifierFlags.contains(.command)
            && event.charactersIgnoringModifiers == "q"
    }
    #endif

    /// Build the `ChordEvent` of one key event. Modifiers are read over
    /// control, option, command, and shift only. `event.timestamp` is
    /// seconds since system startup, the chord clock (design 5.2, Clock).
    static func chordEvent(from event: NSEvent) -> ChordEvent {
        var modifiers = ChordModifiers()
        let flags = event.modifierFlags
        if flags.contains(.control) { modifiers.insert(.control) }
        if flags.contains(.option) { modifiers.insert(.option) }
        if flags.contains(.command) { modifiers.insert(.command) }
        if flags.contains(.shift) { modifiers.insert(.shift) }
        return ChordEvent(
            kind: event.type == .keyUp ? .keyUp : .keyDown,
            timestamp: event.timestamp,
            keyCode: Int64(event.keyCode),
            modifiers: modifiers,
            isRepeat: event.type == .keyDown && event.isARepeat)
    }

    override func keyDown(with event: NSEvent) {
        #if DEBUG
        if Self.isDebugQuit(event) {
            log("debug Command-Q on the window override: terminating")
            NSApplication.shared.terminate(nil)
            return
        }
        #endif
        onChord(Self.chordEvent(from: event))
    }

    override func keyUp(with event: NSEvent) {
        onChord(Self.chordEvent(from: event))
    }
}

/// Raises and drops the curtain windows. Design section 5.4.
@MainActor
final class CurtainController {
    private var windows: [CurtainWindow] = []
    /// Rider R-3: `NSCursor.hide()` runs once per `unhide()`.
    private var cursorHidden = false
    /// Rider B3-F1: the empty screen list is logged once, not once per tick.
    private var loggedNoScreens = false

    /// Forwarded to every window's `onChord`. Set by `AppDelegate`.
    var onChord: (ChordEvent) -> Void = { _ in }

    /// The kiosk options of design section 5.4. `hideMenuBar` and each
    /// `disable*` option are accompanied by `hideDock`, as AppKit requires.
    static let kioskOptions: NSApplication.PresentationOptions = [
        .hideDock, .hideMenuBar, .disableProcessSwitching,
        .disableForceQuit, .disableSessionTermination,
    ]

    /// true while at least one window is up.
    var isUp: Bool { !windows.isEmpty }

    /// One window per `NSScreen.screens`. Idempotent: when the windows
    /// exist it creates none and repeats only the presentation options
    /// and `activate()`. The cursor is hidden once per drop (R-3).
    /// `activate()` is best effort. The tap is the barrier.
    /// Rider B3-F1: with no screens it logs once and returns. It sets no
    /// kiosk state and hides no cursor, so `isUp` and the side effects agree.
    func raise() {
        if windows.isEmpty {
            let screens = NSScreen.screens
            if screens.isEmpty {
                if !loggedNoScreens {
                    log("no screens: curtain not raised")
                    loggedNoScreens = true
                }
                return
            }
            loggedNoScreens = false
            for screen in screens {
                let window = CurtainWindow(screen: screen)
                window.onChord = { [weak self] event in self?.onChord(event) }
                window.makeKeyAndOrderFront(nil)
                windows.append(window)
            }
            log("curtain raised on \(windows.count) screen(s)")
        }
        if !cursorHidden {
            NSCursor.hide()
            cursorHidden = true
        }
        NSApplication.shared.presentationOptions = Self.kioskOptions
        NSApplication.shared.activate()
    }

    /// Order out and release every window, unhide the cursor once,
    /// reset the presentation options. `source` names the feed that
    /// dropped the curtain, for the log line.
    func drop(by source: String) {
        guard isUp else { return }
        for window in windows {
            window.onChord = { _ in }
            window.orderOut(nil)
        }
        windows.removeAll()
        if cursorHidden {
            NSCursor.unhide()
            cursorHidden = false
        }
        NSApplication.shared.presentationOptions = []
        log("curtain dropped by \(source)")
    }

    /// If up: drop and raise again so the window set matches the screens.
    func screensChanged() {
        log("screens changed: \(NSScreen.screens.count) screen(s)")
        guard isUp else { return }
        drop(by: "screen change")
        raise()
    }
}
