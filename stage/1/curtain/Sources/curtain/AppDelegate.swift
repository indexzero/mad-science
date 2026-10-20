import AppKit
import CurtainCore

/// The feed that delivered a chord verdict. Named in the drop log line.
enum ChordFeed: String {
    /// The local event monitor of `AppDelegate` (rider R-4).
    case windowMonitor = "window monitor feed"
    /// `CurtainWindow.keyDown` and `keyUp`, when the monitor is absent.
    case windowOverride = "window override feed"
    /// `ChordDetector.poll` from the tick.
    case tickPoll = "tick poll"
    /// The HID event tap of `InputTap` (dispatch 3).
    case tap = "tap feed"
}

/// true in a debug build, false in release. `swift build` defines DEBUG;
/// `swift build -c release` does not. The one input of the escape hatch
/// of design section 8, layer 1.
#if DEBUG
let isDebugBuild = true
#else
let isDebugBuild = false
#endif

/// Owns every side-effecting object and runs the tick. Design section
/// 5.4. Everything here runs on the main actor.
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let store = ConfigStore()
    private let curtain = CurtainController()
    private let power = PowerController()
    private let tap = InputTap()
    private var detector = ChordDetector()
    private var config = Config.defaults
    /// System uptime of the last chord drop. nil before any drop.
    private var droppedAt: Double?
    /// `Schedule.awake` of the last tick, for the wake handler.
    private var lastAwake = false
    /// true after the debug timeout dropped the tap. The tick does not
    /// install the tap again until the curtain drops. Cleared on `.fired`
    /// and on every tick that sees the curtain down.
    private var tapTimedOut = false
    private var timer: Timer?
    private var keyMonitor: Any?
    private var wakeObserver: (any NSObjectProtocol)?
    private var screenObserver: (any NSObjectProtocol)?

    func applicationDidFinishLaunching(_ note: Notification) {
        config = store.read()
        detector = ChordDetector(
            keyCode: config.chordKeyCode,
            modifiers: config.chordModifiers,
            holdSeconds: config.chordHoldSeconds)
        installKeyMonitor()
        curtain.onChord = { [weak self] event in
            self?.handleChord(event, from: .windowOverride)
        }
        tap.onChord = { [weak self] event in
            self?.handleChord(event, from: .tap)
        }
        // Design section 5.5, "Accessibility": the check runs on launch
        // with the prompt, before the curtain can hide the dialog.
        if !tap.checkTrust() {
            log("accessibility not granted: the tap will be unavailable")
        }
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.didWake() }
        }
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.curtain.screensChanged() }
        }
        startTimer(seconds: config.tickSeconds)
        log("curtain started: tick \(config.tickSeconds) s, idle threshold \(config.idleThresholdSeconds) s")
        tick()
    }

    /// Rider R-4: a local monitor sees keyDown and keyUp before the key
    /// window. While the curtain is up it feeds the detector and returns
    /// nil, so the window override never sees the same event. One path
    /// per event: the monitor when it is installed, else the override.
    private func installKeyMonitor() {
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .keyUp]) { [weak self] event in
            guard let self, self.curtain.isUp else { return event }
            #if DEBUG
            if CurtainWindow.isDebugQuit(event) {
                log("debug Command-Q on the window monitor: terminating")
                NSApplication.shared.terminate(nil)
                return nil
            }
            #endif
            self.handleChord(CurtainWindow.chordEvent(from: event), from: .windowMonitor)
            return nil
        }
        if keyMonitor == nil {
            log("local key monitor unavailable: the window override feeds the chord")
        }
    }

    /// The tick `Timer` on `RunLoop.main` in `.common` mode. Its closure
    /// calls `MainActor.assumeIsolated` and nothing else (design 6).
    private func startTimer(seconds: Double) {
        timer?.invalidate()
        let next = Timer(timeInterval: seconds, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(next, forMode: .common)
        timer = next
    }

    /// One tick, in the order of design section 5.4, "Tick".
    func tick() {
        let fresh = store.read()
        if fresh.tickSeconds != config.tickSeconds {
            log("tick timer replaced: \(config.tickSeconds) s to \(fresh.tickSeconds) s")
            startTimer(seconds: fresh.tickSeconds)
        }
        config = fresh
        detector.keyCode = config.chordKeyCode
        detector.modifiers = config.chordModifiers
        detector.holdSeconds = config.chordHoldSeconds

        let now = Schedule.minutesPastMidnight(Date(), calendar: .current)
        let awake = Schedule.awake(now: now, wake: config.wake, bed: config.bedtime)
        lastAwake = awake
        let uptime = ProcessInfo.processInfo.systemUptime
        let idleSeconds = Idle.effectiveIdle(
            hidIdle: IdleMonitor.idleSeconds(),
            sinceDrop: droppedAt.map { uptime - $0 })
        let idle = Idle.shouldRaise(idleSeconds: idleSeconds, threshold: config.idleThresholdSeconds)
        let state = ReconcileState(
            awake: awake, idle: idle,
            curtainUp: curtain.isUp, assertionHeld: power.assertionHeld)
        let actions = Reconcile.decide(state)
        if actions.contains(.raiseCurtain) {
            curtain.raise()
        }
        if actions.contains(.holdAssertion) {
            power.holdAssertion()
            power.lightPanel()
        }
        if actions.contains(.releaseAssertion) { power.releaseAssertion() }
        if actions.contains(.displaySleepNow) { power.displaySleepNow() }
        if curtain.isUp && !NSApplication.shared.isActive {
            curtain.raise()
        }
        apply(detector.poll(now: uptime), from: .tickPoll)
        // dispatch 3: InputTap install, retry, timeout. The rule runs on
        // every tick, up or down, so a drop without a chord (a screen
        // change with no screens, rider B3-F1) still uninstalls the tap
        // and the debug timeout never waits on `isUp`.
        let shouldDrop = tap.startedAt.map { startedAt in
            TapTimeout.shouldDrop(
                startedAt: startedAt, now: Date(),
                limit: TapTimeout.debugLimit, isDebug: isDebugBuild)
        } ?? false
        let decision = TapLifecycle.decide(
            curtainUp: curtain.isUp, tapInstalled: tap.isInstalled,
            timedOut: tapTimedOut, shouldDrop: shouldDrop)
        switch decision.action {
        case .uninstallCurtainDown:
            tap.uninstall()
            log("tap uninstalled: curtain is down")
        case .uninstallTimeout:
            tap.uninstall()
            log("tap dropped by debug timeout")
        case .install:
            tap.install()
        case .none:
            break
        }
        tapTimedOut = decision.timedOut
    }

    /// Both feeds call this: the window feed (dispatch 2) and the tap
    /// feed (dispatch 3). One detector, two feeds. While the tap is
    /// installed it deletes every event before the window sees it, so
    /// the window feed is silent and no gate is needed.
    func handleChord(_ event: ChordEvent, from feed: ChordFeed) {
        apply(detector.feed(event), from: feed)
    }

    /// The `.fired` handling of design section 5.4: drop, uninstall the
    /// tap, reset, and record the drop as activity.
    private func apply(_ verdict: ChordVerdict, from feed: ChordFeed) {
        guard verdict == .fired else { return }
        curtain.drop(by: feed.rawValue)
        tap.uninstall()
        tapTimedOut = false
        detector.reset()
        droppedAt = ProcessInfo.processInfo.systemUptime
    }

    /// Design section 5.4, "Wake": tick at once, then light the panel
    /// when the schedule says awake.
    private func didWake() {
        log("wake notification")
        tick()
        if lastAwake {
            power.lightPanel()
        }
    }
}
