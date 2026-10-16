# humanish

`humanish` is a Darwin HCI research harness for comparing human and
computer-use interaction traces against executable quantitative models.

The confirmed project intent is in [`../../../INTENT.md`](../../../INTENT.md).

Current stage: **1 — designed, with an executable research scaffold**.

Documents:

- [`SURVEY.md`](SURVEY.md) — open-source substrate survey and selection.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — proposed research architecture.
- [`EXPERIMENT.md`](EXPERIMENT.md) — prior-art controls, human baseline, and
  factored research treatments.

The scaffold contains:

- `HumanishCore`, a platform-neutral Swift library for conditions, Fitts/KLM
  predictions, timestamped motion plans, timing comparisons, and trial
  artifacts;
- `HumanishDarwin`, a foreground CoreGraphics actuator plus a Peekaboo-backed
  accessibility and screenshot observer;
- `humanish`, a CLI for planning, inspecting, capturing, and running one
  accessibility-assisted pointing trial; and
- `web/`, an instrumented, newly authored Manhole-style browser workload.

Run `./check.sh` for the non-interactive checks. See [`RUNBOOK.md`](RUNBOOK.md)
for the explicit macOS permissions and live experiment procedure.

