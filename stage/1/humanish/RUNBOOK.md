# Live Darwin runbook

The first live condition is accessibility-assisted computer use. Its default
treatment, `peekaboo-human`, uses Peekaboo's `human` mouse profile with a fixed
500 ms movement duration and no cognitive delay. This is intentionally an
**unvalidated prior-art machine baseline**: it is useful precisely because its
Bezier/minimum-jerk path, jitter, overshoot, and settling heuristics make a
specific existing claim that the harness can test.

## 1. Build and inspect permissions

```sh
cd stage/1/humanish
swift build
swift run humanish doctor
```

The terminal hosting `humanish` needs these permissions under System Settings
> Privacy & Security:

- Accessibility
- Screen & System Audio Recording

If `humanish doctor` already reports both fields as `true`, no settings change
is needed. Live input never runs without the explicit `--armed` flag.

## 2. Start an independent evidence recorder

Use Python 3.12 rather than the ambient Python 3.14:

```sh
uv venv --python 3.12 .venv-capture
uv pip install --python .venv-capture/bin/python openadapt-capture==1.3.0
```

For a trial directory selected below, start Capture in another terminal:

```sh
.venv-capture/bin/capture record "$TRIAL/capture" \
  --description "humanish Peekaboo-human baseline"
```

OpenAdapt Capture needs Screen & System Audio Recording, Input Monitoring, and
Accessibility.
Its raw events and video are independent evidence; do not derive scientific
timing from Peekaboo's requested duration or from merged high-level events.

## 3. Start the workload

```sh
TRIAL="$PWD/trials/$(date -u +%Y%m%dT%H%M%SZ)-peekaboo-human"
mkdir -p "$TRIAL"
node web/server.mjs --trial-dir "$TRIAL"
```

Open the printed loopback URL in a browser, leave it frontmost, and verify that
the target is visible to macOS Accessibility:

```sh
swift run humanish observe-ax | rg -i "brass hatch"
```

## 4. Run the first baseline movement

```sh
swift run humanish run-ax \
  --label "Open the brass hatch" \
  --artifacts "$TRIAL" \
  --seed 1 \
  --armed
```

For the first end-to-end exploration goal, use the autonomous three-step route
instead. It opens the hatch, climbs the ladder, and looks through the
telescope:

```sh
swift run humanish run-route-ax \
  --artifacts "$TRIAL" \
  --seed 1 \
  --armed
```

`peekaboo-human` is the default. List all factored treatments with
`swift run humanish treatments`; select one with, for example,
`--model peekaboo-human-fitts-goms`.

Each route step requests a fresh macOS Accessibility traversal and briefly
retries if the browser has rendered the next scene before its AX tree has
caught up. Every attempt is retained as `observation-STEP-attempt-ATTEMPT.json`;
the successful tree is also written to `observation-STEP.json`.

Stop Capture after the click, then stop the workload server with Ctrl+C so it
can seal `app-events.jsonl` into `app-terminal.json`. The trial directory then contains the manifest,
AX observation, explicit movement prescription, before/after screenshots,
browser event journal, driver event journal, terminal integrity record, and
the independent OpenAdapt capture.

Verify the finalized harness-owned files and sealed browser journal with:

```sh
swift run humanish verify --artifacts "$TRIAL"
```

## 5. Compare with literature timing samples

Literature datasets are imported as JSON containing citation, provenance, and
raw per-trial samples. Geometry is matched before comparison; the harness uses
empirical percentiles and does not invent a normal distribution:

```sh
swift run humanish compare \
  --reference references/example-dataset.json \
  --observed 0.61 \
  --distance 300 \
  --width 30
```

The example file is a schema fixture, not evidence. Replace it with an
audited import of a primary dataset before drawing scientific conclusions.
