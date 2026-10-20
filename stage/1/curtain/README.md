---
project: curtain
stage: 1
status: "dispatch 1 of 4"
---

# curtain

## Escape hatch

Read this section before you build or run anything.

curtain installs an input tap that swallows every mouse and keyboard event
while the curtain is up. A bug in the chord code locks you out of the Mac.
Three layers get you back in.

1. Debug builds drop the tap after 60 seconds. A plain `swift build` is a
   debug build. The curtain window stays up. The mouse and keyboard work
   again after 60 seconds. The release build has no timeout.
2. Use SSH from another machine and run `pkill curtain`. Keep Remote Login
   on during the test week. Turn it on in System Settings, General, Sharing.
3. The LaunchAgent restarts curtain when it exits. Stop the restart first
   when you do not want it:

   ```sh
   launchctl bootout gui/$(id -u)/family.curtain
   pkill curtain
   ```

In a debug build, Command-Q on the curtain window also quits the process.

No agent installs or runs curtain on the development machine. The owner
runs it on the family Mac after the checklist in a later section.

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
