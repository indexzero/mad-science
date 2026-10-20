---
project: curtain
stage: 1
status: "built, stage 1 (owner verification pending)"
---

# curtain

## Escape hatch

Read this section before you build or run anything.

curtain installs an input tap that swallows every mouse and keyboard event
while the curtain is up. The tap exists in the code from dispatch 3 on.
While the tap is installed, no key and no mouse event reaches any other
app. A bug in the chord code locks you out of the Mac. Three layers get
you back in. Without the Accessibility grant (see "The Accessibility
grant" below) the tap is not installed, and the curtain still takes the
chord from the key window.

1. Debug builds drop the tap 60 seconds after it is installed. A plain
   `swift build` is a debug build. The curtain window stays up. The mouse
   and keyboard work again after 60 seconds. The tap is not installed again
   until the curtain drops and rises again. A debug build also quits on
   Command-Q while a curtain window is key. The release build never drops
   the tap and has no Command-Q path.
2. Use SSH from another machine and run `pkill curtain`. Keep Remote Login
   on during the test week. Turn it on in System Settings, General, Sharing.
3. The LaunchAgent restarts curtain when it exits. Stop the restart first
   when you do not want it:

   ```sh
   launchctl bootout gui/$(id -u)/family.curtain
   pkill curtain
   ```

No agent installs or runs curtain on the development machine. The owner
runs it on the family Mac. The owner checklist is in the section "Owner
checklist" below.

## What it does

curtain is one resident macOS app for a family Mac with kid accounts.
After five minutes without input it raises a black window on every
display and swallows every input event. The curtain drops only when
Control-Option-Command-U is held for two seconds. During awake hours,
07:00 to 19:30, it holds a display assertion so the panel stays lit. At
bedtime it releases the assertion and puts the display to sleep. A
`pmset repeat` schedule set once by the owner wakes the Mac at 07:00.

## Build

You need a Swift 6.2 toolchain or newer and macOS 26 or newer.

```sh
swift build -c release
swift test
bash check.sh
```

`check.sh` runs the release build, the test suite, and the install script
test. It exits 0 when all three pass. That is the machine-checkable Done
for this package.

The release binary is at `.build/release/curtain`. Do not run it on a
machine you cannot reach over SSH.

## The Accessibility grant

The input tap needs the Accessibility grant. Without it
`CGEvent.tapCreate` returns nil, the tap is not installed, and the log
says:

```
tap unavailable: grant Accessibility (and Input Monitoring) to curtain
```

The curtain stays up without the tap. The chord still drops it through
the key window. The tap is tried again on every tick, so the grant takes
effect within one tick.

Grant it once per installed binary:

1. Open System Settings, Privacy & Security, Accessibility.
2. Click the plus button and add the installed copy at
   `~/Library/Application Support/family.curtain/bin/curtain`.
   `scripts/install-agent.sh` creates it. For a test run before you
   install, add the build output `.build/release/curtain` instead.
3. Turn the switch on.

If the log still says `tap unavailable` after the grant, also add the
binary under System Settings, Privacy & Security, Input Monitoring.

curtain asks for the grant with the system prompt once per process. The
prompt appears at launch, before the curtain rises. The prompt does not
change what the tap does. The grant is bound to the binary. After a
rebuild, check the log line. If the tap is unavailable again, remove the
old entry and add the binary again.

When the tap is installed the log says `tap installed at HID` or
`tap installed at session`. When the tap drops it says `tap uninstalled`.
When the curtain is down and the tap is still installed, for example
after a screen change that left no screen, the next tick uninstalls it
and the log also says `tap uninstalled: curtain is down`. A debug build
logs `tap dropped by debug timeout` 60 seconds after install while the
curtain is up. While the curtain is down the next tick removes the tap
first, under the line above.

## The pmset lines

The wake schedule is a system setting. The app never writes it. Set it
once as an administrator. It applies to the whole Mac, not to one
account.

```sh
sudo pmset repeat wakeorpoweron MTWRFSU 07:00:00
```

The time matches the `wake` key, 07:00 by default. If you change `wake`,
run the line again with the new time. The schedule lives in
`/Library/Preferences/SystemConfiguration/com.apple.AutoWake.plist`.

Show the schedule:

```sh
pmset -g sched
```

Show the power assertions. During awake hours, with the curtain up, one
line names `curtain` and the reason `curtain awake hours`. Outside awake
hours no curtain line is present:

```sh
pmset -g assertions
```

Remove the schedule:

```sh
sudo pmset repeat cancel
```

## Install and uninstall

Install in each kid account, after the Accessibility grant for that
account. Log in as the account and run the script from the package
directory.

See what the script would write, without writing anything:

```sh
bash scripts/install-agent.sh --print
```

`--print` renders the LaunchAgent plist to stdout with the paths for the
current `$HOME`. It writes no file and runs no `launchctl`.

Install:

```sh
swift build -c release
bash scripts/install-agent.sh
```

The script copies `.build/release/curtain` to
`~/Library/Application Support/family.curtain/bin/curtain`, writes
`~/Library/LaunchAgents/family.curtain.plist`, unloads an old agent if
one is loaded, loads the new one with `launchctl bootstrap`, and prints
the escape hatch reminder. The copy has a stable path, so the
Accessibility grant survives a rebuild of `.build/`. Run the script again
after a rebuild. It is safe to run twice.

To install a binary from another path, pass it as the argument:

```sh
bash scripts/install-agent.sh /path/to/curtain
```

The agent has `RunAtLoad` and `KeepAlive`. It starts at login and
restarts curtain when the process exits. The logs are:

```
~/Library/Logs/family.curtain/curtain.out.log
~/Library/Logs/family.curtain/curtain.err.log
```

The app logs one line per state change to `curtain.err.log`.

Uninstall:

```sh
bash scripts/uninstall-agent.sh
```

The script unloads the agent, removes the plist, and removes the binary
directory. It keeps the logs and the defaults and prints the commands
that remove them (`defaults delete family.curtain`). It does not change
the pmset schedule.

Test the install script without installing anything:

```sh
bash scripts/install-agent.test.sh
```

The test runs `--print` under a temporary `HOME`, compares the output
with the template, and checks that nothing was written. `check.sh` runs
it. Set `CURTAIN_TEST_HOME` to use a directory of your choice.

## Owner checklist

Do these in order on the family Mac: build the release binary, install
with `scripts/install-agent.sh` in the kid account, grant Accessibility
to the installed copy, set the pmset line. Then check each item. Keep an
SSH session open from another machine.

- [ ] Bump the mouse and the curtain stays.
- [ ] Hold the chord two seconds and it drops.
- [ ] `pmset -g assertions` shows the assertion only during awake hours.
- [ ] At bedtime the display goes dark within a minute.
- [ ] A scheduled wake lights the panel.

For the last item, set `pmset repeat` to a time a few minutes ahead, let
the display sleep, and watch the panel light up at that time. Then set
the schedule back to 07:00.

For a first test, run a debug build before you install the agent. The
debug build drops the tap after 60 seconds, so a mistake in the chord
cannot lock you out for long. For that run, grant Accessibility to
`.build/debug/curtain`.

## Configuration keys

The app reads the `family.curtain` defaults domain on every tick. A
change takes effect within one tick. A malformed value falls back to the
default for that key and is logged once.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `bedtime` | string `"HH:MM"` | `"19:30"` | the end of awake hours |
| `wake` | string `"HH:MM"` | `"07:00"` | the start of awake hours |
| `idleThresholdSeconds` | float | `300` | seconds without input before the curtain rises |
| `chordKeyCode` | integer | `32` | the virtual key code of the chord letter (32 is U) |
| `chordModifiers` | array of string | `control`, `option`, `command` | the modifiers of the chord, an exact match |
| `chordHoldSeconds` | float | `2.0` | how long the chord is held |
| `tickSeconds` | float | `1.0` | the poll interval, clamped to 0.2 to 60 |

One example per key:

```sh
defaults write family.curtain bedtime -string "20:30"
defaults write family.curtain wake -string "06:30"
defaults write family.curtain idleThresholdSeconds -float 600
defaults write family.curtain chordKeyCode -int 32
defaults write family.curtain chordModifiers -array control option command shift
defaults write family.curtain chordHoldSeconds -float 3
defaults write family.curtain tickSeconds -float 0.5
```

The modifier names are `control`, `option`, `command`, and `shift`. If
`bedtime` equals `wake`, bedtime is disabled and the assertion is held
whenever the curtain is up. Set a key per kid account: the domain is per
user.

Show the current values, or remove them all:

```sh
defaults read family.curtain
defaults delete family.curtain
```

## Note

`workstation/` in robbinshinds.family is paused. Nothing lands there
until the owner asks. This package is complete on its own: the scripts
above install it, without nix-darwin.
