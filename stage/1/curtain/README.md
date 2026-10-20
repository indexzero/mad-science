---
project: curtain
stage: 1
status: "dispatch 3 of 4"
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
runs it on the family Mac. The owner checklist lands in a later dispatch.

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

`check.sh` runs the release build and the test suite. It exits 0 when
both pass. That is the machine-checkable Done for this package.

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
2. Click the plus button and add the installed binary. The release build
   is at `.build/release/curtain`.
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
A debug build logs `tap dropped by debug timeout` after 60 seconds.
