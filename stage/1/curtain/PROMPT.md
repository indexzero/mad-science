---
stage: 1
project: curtain
status: "built, stage 1 (owner verification pending)"
source_chat: c85053b6
run_issue: "https://github.com/indexzero/orckits/issues/16"
design: "TECHNICAL.DESIGN.md in the orckits run home indexzero/mad-science/2026-10-curtain/"
---

# curtain

One resident macOS app. After idle it raises a black curtain on every display and
swallows every input event. It drops only when Control-Option-Command-U is held
for two seconds. During awake hours (07:00 to 19:30) it holds a display assertion.
At bedtime it releases the assertion and sleeps the display. `pmset repeat` wakes
the machine at 07:00.

Modules: core-schedule, core-chord, power, ui-curtain, input-tap, packaging.
Pure logic in `CurtainCore`, proven by `swift test`. Side effects in `curtain`,
proven by the owner with the README checklist. `bash check.sh` is Done.

## Assembled design

The chat of 2026-10-06 left four Swift fragments and a set of shell lines.
The design assembled them into one SwiftPM package with two targets and a
test target. This section is the short form. The full design, with the
sources and the verified facts, is the file named in the frontmatter.

### Module map

`CurtainCore` is a pure library. It has no AppKit, no side effects, and no
global state. Every type is a value type and `Sendable`.

- `Schedule`: minutes past midnight, `parseHHMM`, and the `awake` rule.
- `Idle`: `shouldRaise` against the threshold, and `effectiveIdle`, which
  takes the smaller of the HID idle time and the time since the last chord
  drop. The drop counts as activity even if the swallowed events did not
  reset the system counter.
- `Reconcile`: the per-tick decision. Four inputs in, a set of actions out.
- `Config` and `RawConfig`: the seven keys, the defaults, and the parse
  with per-key fallback.
- `Chord`: `ChordEvent`, `ChordDetector`, and the hold rule.
- `Power`: the `pmset` argument lists.
- `TapTimeout`: the 60 second debug rule. Always false in release.
- `TapLifecycle`: when the tap is installed, kept, or removed on a tick.

`curtain` is the executable. Everything in it runs on the main actor.

- `main.swift`: an accessory `NSApplication` with the delegate.
- `AppDelegate`: the tick timer, the apply step, `handleChord`, the wake
  and screen change observers.
- `CurtainWindow` and `CurtainController`: one borderless window per
  screen at screen saver level, the kiosk presentation options, and the
  window feed that hands key events to the chord detector.
- `IdleMonitor`: the HID idle time from CoreGraphics.
- `ConfigStore`: reads the `family.curtain` defaults each tick.
- `PowerController`: the display assertion, `pmset displaysleepnow`, and
  the panel light call.
- `InputTap`: the CoreGraphics event tap. HID location first, session
  location second. Every event is swallowed. Key events reach the chord
  detector. A tap disabled by the system is enabled again.
- `Log`: one line per state change to stderr with a timestamp.

### The tick

Every tick, one second by default, the delegate reads the config, computes
the time of day and the idle time, and asks `Reconcile.decide` what to do.
It applies the actions in a fixed order: raise the curtain, hold the
assertion, release the assertion, sleep the display. It then polls the chord
detector and runs the tap lifecycle rule.

### Reconcile rules

Four booleans go in: `awake`, `idle`, `curtainUp`, `assertionHeld`. The
curtain is wanted when it is already up or the machine is idle. The
assertion is wanted when the curtain is wanted and the hours are awake.

- Raise the curtain when idle and the curtain is down.
- Hold the assertion when it is wanted and not held.
- Release the assertion when it is not wanted and held.
- Sleep the display when the hours are not awake, the curtain is wanted,
  and this tick raises the curtain or releases the assertion.

The reconcile never drops the curtain. Only the chord drops it. Idle is the
only raise trigger, so bedtime does not raise the curtain over an active
user. The display sleeps once, at the bedtime transition. A later bump
lights the panel and the system timer darkens it again.

### The awake rule

If `wake` equals `bedtime`, every minute is awake. If `wake` is earlier than
`bedtime`, a minute is awake when it is at or after `wake` and before
`bedtime`. Otherwise bedtime is past midnight, and a minute is awake unless
it is at or after `bedtime` and before `wake`.

### The chord rule

A press of the chord key with exactly the chord modifiers arms the detector
at the event time. Key repeats past the hold time fire it. A release of the
chord key, or a press of any other key, resets it. A second physical press
re-arms it. The tick also polls the detector with the system uptime, so the
chord fires even when key repeat is turned off. The clock for both feeds is
seconds since boot.

### The tap lifecycle

The tap is installed in the tick that raises the curtain and tried again
every tick while the grant is missing. It is removed when the chord fires,
whenever the curtain is down, and in a debug build 60 seconds after
install. After the debug timeout it is not installed again until the
curtain drops and rises again.

### Packaging

`scripts/install-agent.sh` copies the release binary to a stable path under
`~/Library/Application Support/family.curtain/bin/`, renders the plist from
`scripts/family.curtain.plist.template`, and loads it with `launchctl`.
`--print` only renders. `scripts/uninstall-agent.sh` reverses it and keeps
the logs. `scripts/install-agent.test.sh` proves `--print` under a
temporary `HOME`. The owner installs, per kid account. No agent installs or
runs curtain on the build machine.
