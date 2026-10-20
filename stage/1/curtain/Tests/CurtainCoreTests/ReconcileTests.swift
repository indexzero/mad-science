import Testing
@testable import CurtainCore

/// One row of the `Reconcile.decide` table, design section 5.1.
struct ReconcileRow: Sendable, CustomTestStringConvertible {
    let number: Int
    let awake: Bool
    let idle: Bool
    let curtainUp: Bool
    let assertionHeld: Bool
    let actions: Set<ReconcileAction>

    var testDescription: String {
        "row \(number): awake \(awake) idle \(idle) up \(curtainUp) held \(assertionHeld)"
    }

    var state: ReconcileState {
        ReconcileState(awake: awake, idle: idle, curtainUp: curtainUp, assertionHeld: assertionHeld)
    }
}

/// Tests for `Reconcile`, design section 10.
struct ReconcileTests {
    /// The 16 rows of the design table. Columns: awake, idle, up, held.
    static let rows: [ReconcileRow] = [
        ReconcileRow(number: 1, awake: false, idle: false, curtainUp: false, assertionHeld: false, actions: []),
        ReconcileRow(number: 2, awake: false, idle: false, curtainUp: false, assertionHeld: true, actions: [.releaseAssertion]),
        ReconcileRow(number: 3, awake: false, idle: false, curtainUp: true, assertionHeld: false, actions: []),
        ReconcileRow(number: 4, awake: false, idle: false, curtainUp: true, assertionHeld: true, actions: [.releaseAssertion, .displaySleepNow]),
        ReconcileRow(number: 5, awake: false, idle: true, curtainUp: false, assertionHeld: false, actions: [.raiseCurtain, .displaySleepNow]),
        ReconcileRow(number: 6, awake: false, idle: true, curtainUp: false, assertionHeld: true, actions: [.raiseCurtain, .releaseAssertion, .displaySleepNow]),
        ReconcileRow(number: 7, awake: false, idle: true, curtainUp: true, assertionHeld: false, actions: []),
        ReconcileRow(number: 8, awake: false, idle: true, curtainUp: true, assertionHeld: true, actions: [.releaseAssertion, .displaySleepNow]),
        ReconcileRow(number: 9, awake: true, idle: false, curtainUp: false, assertionHeld: false, actions: []),
        ReconcileRow(number: 10, awake: true, idle: false, curtainUp: false, assertionHeld: true, actions: [.releaseAssertion]),
        ReconcileRow(number: 11, awake: true, idle: false, curtainUp: true, assertionHeld: false, actions: [.holdAssertion]),
        ReconcileRow(number: 12, awake: true, idle: false, curtainUp: true, assertionHeld: true, actions: []),
        ReconcileRow(number: 13, awake: true, idle: true, curtainUp: false, assertionHeld: false, actions: [.raiseCurtain, .holdAssertion]),
        ReconcileRow(number: 14, awake: true, idle: true, curtainUp: false, assertionHeld: true, actions: [.raiseCurtain]),
        ReconcileRow(number: 15, awake: true, idle: true, curtainUp: true, assertionHeld: false, actions: [.holdAssertion]),
        ReconcileRow(number: 16, awake: true, idle: true, curtainUp: true, assertionHeld: true, actions: []),
    ]

    @Test(arguments: rows) func table(row: ReconcileRow) {
        #expect(Reconcile.decide(row.state) == row.actions)
    }

    @Test func tableHasSixteenDistinctRows() {
        #expect(Self.rows.count == 16)
        let keys = Self.rows.map { [$0.awake, $0.idle, $0.curtainUp, $0.assertionHeld] }
        #expect(Set(keys).count == 16)
    }
}
