# Open-source computer-use substrate survey

Date: 2026-10-31

## Selection criteria

The initial substrate must run on Darwin and provide:

1. arbitrary-application observation through macOS Accessibility;
2. screenshots in an explicit coordinate space;
3. foreground pointer and keyboard input capable of contesting the human locus
   of attention;
4. machine-readable results and stable target identity;
5. a library or protocol boundary beneath any particular agent/model;
6. raw, synchronized evidence suitable for quantitative HCI analysis;
7. a permissive license and source that can be pinned for reproducibility.

The first controller is accessibility-assisted. Pixel-only control and human
recording must remain first-class experimental conditions rather than later
rewrites.

## Decision

Use a composition rather than asking one project to be controller, recorder,
experimental scheduler, task environment, and evaluator:

- **Peekaboo AutomationKit** is the initial Darwin observer/actuator substrate.
- **OpenAdapt Capture** is the initial raw evidence recorder.
- **humanish** owns research models, scheduling, trial manifests, clock
  alignment, analysis, and the instrumented Manhole workload.
- **Cua Driver** remains a planned compatibility backend and a strong future
  option for pixel-only/VM experiments, but is not the phase-one actuator.

The selected versions inspected for this decision were:

| Project | Inspected revision | License |
|---|---|---|
| [Peekaboo](https://github.com/openclaw/Peekaboo) | `653645cbddb596c8077940fce2506a32cb48f580` | MIT |
| [OpenAdapt](https://github.com/OpenAdaptAI/OpenAdapt) | `14a6e405aaa4007531e3ea41eea9e974fdf2cf8f` | MIT |
| [Cua](https://github.com/trycua/cua) | `2b7bd1b9046b63079f684810e8729a84f967a128` | Cua Driver MIT; some unrelated/optional components use other terms |

Every experiment must retain the exact dependency revisions actually used,
not just these survey revisions.

Host validation: `swift build --product PeekabooAutomationKit` completed
successfully from the inspected Peekaboo revision on macOS 27.0.1 with Apple
Swift 6.4. This validates the library integration seam; it does not yet grant
Screen & System Audio Recording or Accessibility permission or demonstrate a
live UI action.

## Why Peekaboo

[Peekaboo](https://github.com/openclaw/Peekaboo) is a Darwin-native Swift
automation system with macOS Accessibility inspection, screenshots, application
and window targeting, and foreground physical-cursor/keyboard actions. Its root
Swift package exports `PeekabooAutomationKit` as a library rather than requiring
the CLI or MCP agent loop.

The relevant source seam is unusually close to this research:

- `MouseMovementProfile` distinguishes linear and human-style motion;
- `HumanMouseProfileConfiguration` exposes seeded jitter, overshoot, and
  settling parameters;
- `GestureService` accepts duration and sample count;
- its human profile uses a cubic Bézier path with minimum-jerk progress;
- foreground events are posted through the CoreGraphics HID event tap;
- the CLI can inspect AX elements and screenshots and returns JSON.

Peekaboo's existing human profile is a useful **baseline**, not a scientific
model to accept as ground truth. Its current public profile enum is closed to
`linear` and `human`, its default duration curve is heuristic, and path samples
are replayed at equal intervals. The phase-one integration therefore uses
AutomationKit for observation and ordinary actions while `humanish` defines its
own model-neutral `MotionPlan`. A small Swift adapter will play an explicit
timestamped path through the same foreground CoreGraphics channel. This keeps
the research model out of a vendor-specific enum and makes the emitted plan
auditable before execution.

## Why OpenAdapt Capture

[OpenAdapt Capture](https://github.com/OpenAdaptAI/OpenAdapt/tree/main/packages/capture)
already records the evidence this research would otherwise have to build:

- raw mouse move/down/up/scroll and keyboard down/up events;
- float Unix timestamps documented as sub-millisecond precision;
- source ordinals preserving native journal order;
- screen video and exact before/after frame binding;
- macOS Accessibility observations attached at action time;
- window geometry, display topology, pixel scale, and coordinate provenance;
- a local SQLite session plus integrity manifest and completion record.

The raw journal is the research artifact. OpenAdapt's derived actions and
merged mouse paths are useful views but must not replace the raw samples used
for kinematic or timing analysis.

OpenAdapt uses Python and currently declares Python 3.10+. The local machine's
default Python is newer than the versions listed in its classifiers, so
`humanish` should use a project-pinned Python 3.12 environment rather than the
ambient interpreter.

## Cua Driver

[Cua Driver](https://github.com/trycua/cua) is the strongest broader
alternative. It provides:

- combined accessibility trees and screenshots;
- foreground and background delivery;
- exact window/desktop targets;
- CLI, MCP, and typed SDK surfaces;
- real pointer input for desktop targets;
- a surrounding VM, benchmark, and trajectory ecosystem.

It is not the initial actuator because its public `MoveCursorInput` describes a
destination rather than an arbitrary timestamped path. Much of its Darwin
design correctly optimizes for background agents that leave the user's focus
and pointer alone, whereas contested foreground attention is an intentional
experimental variable here. Cua remains valuable as:

- a future backend for pixel-only trials;
- a VM/isolation provider;
- an interoperability target for trial and trajectory formats;
- an external comparison against the Peekaboo-backed actuator.

Only Cua Driver's MIT portion should be considered. Cua Spaces, Driver Bench,
and optional perception artifacts have different licenses and are not required
for this design.

## Other systems considered

| System | Strength | Reason not selected as the initial substrate |
|---|---|---|
| [agent-desktop](https://github.com/vercel-labs/agent-desktop) | Compact Apache-2.0 AX CLI/C library with stable element references | Deliberately no pixel matching and no research-grade physical pointer trajectory surface |
| [screencommander](https://github.com/0xSMW/screencommander) | AX, screenshots, UI-change stream, frame diffs, tiered delivery | Very young project and primarily background/no-cursor oriented |
| [open-computer-use](https://github.com/opensymph/open-computer-use) | Accessibility-first actions plus display capture and global Darwin input | Useful breadth, but less direct model-extension seam than Peekaboo AutomationKit |
| [Leap](https://github.com/ryanwyler/leap-mcp) | Model-agnostic macOS AX control with screenshots and evidence | Background control and MCP product boundary are less suitable for precise motor scheduling |
| [OSWorld V2](https://github.com/xlang-ai/OSWorld-V2) | Mature task/evaluator/trajectory benchmark architecture | Benchmark rather than Darwin observation/actuation library; useful format reference, not the driver |
| [SikuliX](https://github.com/RaiMan/SikuliX1) | Long-lived screenshot/pattern-based automation | Pixel template automation does not supply the AX-first phase or synchronized HCI evidence |

## Vision-model decision

Do **not** train a custom vision model in phase one.

The accessibility-first condition does not need one, and introducing learned
grounding before the trial/evidence schema is stable would confound model error
with harness error. Screenshots must still be retained from the first trial.
The AX tree and instrumented application's exact hotspot geometry can later
produce aligned labels for a pixel-only corpus. A custom model becomes
justified only after a measured grounding failure that generic vision or
set-of-mark observation cannot resolve.

This ordering preserves a useful future experiment: compare the same controller
with AX, generic vision, and a task-trained vision model while holding the
actuator and task policy constant.

## Rejected architecture

The harness must not be implemented as a sequence of shell calls whose elapsed
time is treated as human action time. Process startup, JSON serialization,
model inference, observation, cognitive operators, and motor execution need
separate clocks and trace spans. Otherwise the experiment measures tooling
overhead and mislabels it as HCI behavior.

