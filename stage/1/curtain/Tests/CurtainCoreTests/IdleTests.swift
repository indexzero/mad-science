import Testing
@testable import CurtainCore

/// Tests for `Idle`, design section 10.
struct IdleTests {
    @Test func shouldRaise() {
        #expect(Idle.shouldRaise(idleSeconds: 299.9, threshold: 300) == false)
        #expect(Idle.shouldRaise(idleSeconds: 300, threshold: 300) == true)
        #expect(Idle.shouldRaise(idleSeconds: 301, threshold: 300) == true)
        #expect(Idle.shouldRaise(idleSeconds: 0, threshold: 0) == true)
        #expect(Idle.shouldRaise(idleSeconds: 0.001, threshold: 0) == true)
        #expect(Idle.shouldRaise(idleSeconds: 100_000, threshold: 0) == true)
    }

    @Test func dropCountsAsActivity() {
        #expect(Idle.effectiveIdle(hidIdle: 400, sinceDrop: 3) == 3)
        #expect(Idle.effectiveIdle(hidIdle: 400, sinceDrop: nil) == 400)
        #expect(Idle.effectiveIdle(hidIdle: 2, sinceDrop: 300) == 2)
    }
}
