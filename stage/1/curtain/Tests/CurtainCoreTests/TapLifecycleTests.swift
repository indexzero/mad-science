import Foundation
import Testing
@testable import CurtainCore

/// One row of the `TapLifecycle.decide` table.
struct TapLifecycleRow: Sendable, CustomTestStringConvertible {
    let name: String
    let curtainUp: Bool
    let tapInstalled: Bool
    let timedOut: Bool
    let shouldDrop: Bool
    let decision: TapLifecycle.Decision

    var testDescription: String { name }
}

/// Tests for `TapLifecycle`, the per-tick tap rule of design section
/// 5.5 and the escape hatch of section 8. The rule runs on every tick,
/// up or down. Review finding D-012 F-1 and D-013 F-1.
struct TapLifecycleTests {
    static let rows: [TapLifecycleRow] = [
        // Normal raise: the curtain is up and the tap is not installed yet.
        TapLifecycleRow(
            name: "raise: install", curtainUp: true, tapInstalled: false, timedOut: false, shouldDrop: false,
            decision: .init(action: .install, timedOut: false)),
        // Normal up: the tap is installed and the timeout is not due.
        TapLifecycleRow(
            name: "up: keep", curtainUp: true, tapInstalled: true, timedOut: false, shouldDrop: false,
            decision: .init(action: .none, timedOut: false)),
        // Idle down: nothing to do.
        TapLifecycleRow(
            name: "down: nothing", curtainUp: false, tapInstalled: false, timedOut: false, shouldDrop: false,
            decision: .init(action: .none, timedOut: false)),
        // Case (a): screensChanged with no screens left the curtain down
        // and the tap installed. The next tick uninstalls it.
        TapLifecycleRow(
            name: "a: down with tap: uninstall", curtainUp: false, tapInstalled: true, timedOut: false, shouldDrop: false,
            decision: .init(action: .uninstallCurtainDown, timedOut: false)),
        // Case (a), debug: the timeout is also due. The down rule wins.
        TapLifecycleRow(
            name: "a: down with tap, timeout due: uninstall", curtainUp: false, tapInstalled: true, timedOut: false, shouldDrop: true,
            decision: .init(action: .uninstallCurtainDown, timedOut: false)),
        // Case (b), step 1: the debug timeout fires while up.
        TapLifecycleRow(
            name: "b1: up, timeout due: drop", curtainUp: true, tapInstalled: true, timedOut: false, shouldDrop: true,
            decision: .init(action: .uninstallTimeout, timedOut: true)),
        // Case (b), step 2: still up after the timeout. No retry.
        TapLifecycleRow(
            name: "b2: up after timeout: no retry", curtainUp: true, tapInstalled: false, timedOut: true, shouldDrop: false,
            decision: .init(action: .none, timedOut: true)),
        // Case (b), step 3: the curtain dropped without a chord after the
        // timeout. The stale flag is cleared on the down tick.
        TapLifecycleRow(
            name: "b3: down after timeout: clear flag", curtainUp: false, tapInstalled: false, timedOut: true, shouldDrop: false,
            decision: .init(action: .none, timedOut: false)),
        // Case (b), step 4: the curtain rose again. The tap is installed.
        TapLifecycleRow(
            name: "b4: rise after drop: install", curtainUp: true, tapInstalled: false, timedOut: false, shouldDrop: false,
            decision: .init(action: .install, timedOut: false)),
        // Case (c): release build, up for an hour. `shouldDrop` is always
        // false in release, so the tap stays.
        TapLifecycleRow(
            name: "c: release up for an hour: keep", curtainUp: true, tapInstalled: true, timedOut: false, shouldDrop: false,
            decision: .init(action: .none, timedOut: false)),
    ]

    @Test(arguments: rows) func decide(_ row: TapLifecycleRow) {
        let decision = TapLifecycle.decide(
            curtainUp: row.curtainUp, tapInstalled: row.tapInstalled,
            timedOut: row.timedOut, shouldDrop: row.shouldDrop)
        #expect(decision == row.decision)
    }

    /// The release build passes `isDebug: false`, so `shouldDrop` is false
    /// for any uptime. The rule then never drops an installed tap while up.
    @Test func releaseNeverDropsWhileUp() {
        let started = Date(timeIntervalSinceReferenceDate: 1_000_000)
        let hour = started.addingTimeInterval(3600)
        let drop = TapTimeout.shouldDrop(startedAt: started, now: hour, limit: TapTimeout.debugLimit, isDebug: false)
        let decision = TapLifecycle.decide(curtainUp: true, tapInstalled: true, timedOut: false, shouldDrop: drop)
        #expect(decision == .init(action: .none, timedOut: false))
    }
}
