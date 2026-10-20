import Foundation
import IOKit.pwr_mgt
import CurtainCore

/// The display assertion, the bedtime display sleep, and the panel
/// light. Design section 5.3. All side effects, no decisions.
@MainActor
final class PowerController {
    private var activity: (any NSObjectProtocol)?

    /// true while the beginActivity token is held.
    var assertionHeld: Bool { activity != nil }

    /// Take the idle display sleep assertion. Idempotent.
    func holdAssertion() {
        guard activity == nil else { return }
        activity = ProcessInfo.processInfo.beginActivity(
            options: .idleDisplaySleepDisabled, reason: "curtain awake hours")
        log("assertion held")
    }

    /// Release the assertion. Idempotent.
    func releaseAssertion() {
        guard let activity else { return }
        ProcessInfo.processInfo.endActivity(activity)
        self.activity = nil
        log("assertion released")
    }

    /// Run `/usr/bin/pmset displaysleepnow`. Log the exit code and the
    /// output. Never throws out. The app never runs `pmset repeat`.
    /// Rider B4-F1: stdout and stderr share one pipe, read once, so a
    /// chatty child cannot fill the other pipe and block.
    func displaySleepNow() {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/pmset")
        process.arguments = Power.displaySleepArgs
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output
        do {
            try process.run()
        } catch {
            log("pmset displaysleepnow failed to start: \(error)")
            return
        }
        let text = Self.text(output.fileHandleForReading.readDataToEndOfFile())
        process.waitUntilExit()
        log("pmset displaysleepnow exit \(process.terminationStatus) output: [\(text)]")
    }

    /// Declare local user activity so the panel powers on. Used after a
    /// wake notification and after `holdAssertion`. Logs only a failure.
    func lightPanel() {
        var assertionID: IOPMAssertionID = 0
        let result = IOPMAssertionDeclareUserActivity(
            "curtain wake" as CFString, kIOPMUserActiveLocal, &assertionID)
        if result != kIOReturnSuccess {
            log("light panel: IOPMAssertionDeclareUserActivity returned \(result)")
        }
    }

    /// Pipe bytes as trimmed UTF-8 text.
    private static func text(_ data: Data) -> String {
        String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
