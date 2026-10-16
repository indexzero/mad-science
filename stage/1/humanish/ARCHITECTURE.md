# Proposed architecture

## Boundary

The harness is an experiment runtime around interchangeable perception,
cognition, and motor implementations. Neither the Manhole workload nor
Peekaboo is the architecture.

```text
                         experiment manifest
                                  |
                                  v
  literature priors ---> model + trial scheduler <--- seeded condition
                                  |
                       timestamped ActionPlan
                                  |
                    Darwin driver abstraction
                     /          |          \
              AX observer   pixel observer  foreground actuator
                  |              |                 |
                  +------- arbitrary macOS UI -----+
                                  |
                 OpenAdapt raw event/video recorder
                                  |
                     immutable trial artifact
                                  |
              feature extraction + model comparison
```

## Experimental conditions

All conditions produce the same trial artifact schema:

1. `human` — raw operator input and pixels; AX may annotate but never guide.
2. `computer-ax` — screenshots plus AX-assisted target selection.
3. `computer-pixels` — screenshots only for target selection.

The first runnable condition is `computer-ax`. The other two are schema and
adapter obligations from the beginning.

## Components

### Trial scheduler

Owns seeds, task assignment, model parameters, randomized condition order,
timeouts, aborts, and lifecycle. It never performs UI input directly.

### Research models

Pure functions or state machines that consume a task state and emit an
auditable plan. Initial operators include:

- `M` — mental preparation;
- `P` — pointing/target acquisition;
- `K` — key or button actuation;
- `H` — homing between input modalities;
- `R` — application response waiting.

Fitts parameters predict movement duration from target distance and width.
KLM/GOMS predicts operator structure and timing. Familiarity changes method
selection and preparation rather than being represented as cursor noise.

### Darwin driver

The driver protocol separates:

- `observeAX(target)`;
- `observePixels(target)`;
- `frontmostApplication()` and exact window identity;
- `execute(ActionPlan)`;
- `emergencyStop()`.

The initial implementation wraps Peekaboo AutomationKit. An action plan
contains intended monotonic timestamps and explicit events; the driver returns
actual emission timestamps and errors. AX actions and physical input are
different action kinds and must remain distinguishable in the trace.

### Recorder

OpenAdapt Capture records the external truth of what Darwin received and what
the screen displayed. It runs independently from the driver so a driver cannot
declare its own success. Raw input events are never replaced by processed
gestures.

### Workload adapter

A workload describes goals and ground-truth predicates without controlling the
UI. The Manhole browser application is the first adapter and reports:

- scene and transition identity;
- hotspot rectangles and salience condition;
- pointer entry/exit/down/up/click with `performance.now()`;
- hits, misses, exploration, and completion;
- viewport, device-pixel ratio, focus, visibility, and resize events.

The application receives no privileged messages telling the controller where
to click. Ground truth is written to the evaluator channel, not exposed as an
observation to the experimental agent.

## Clock model

At minimum, preserve four clocks:

1. scheduler monotonic clock;
2. driver monotonic emission clock;
3. recorder native/wall clock and source ordinal;
4. browser `performance.now()` plus its time origin.

Trials begin and end with observable synchronization markers. Analysis fits
clock offsets/drift and reports residual error; it must not assume wall-clock
timestamps from independent processes are identical.

## Trial artifact

Each trial directory is immutable after finalization and contains:

```text
manifest.json          exact versions, hashes, task, condition, seed
plan-000.json ...       intended movement prescription for each route step
scheduler-events.jsonl  intended and actual cognitive-delay spans
driver-events.jsonl     actual driver observations/emissions/results
app-events.jsonl        instrumented workload ground truth
capture/                OpenAdapt raw recording and integrity files
analysis/               derived features and comparisons
terminal.json           completion/abort state and artifact digests
```

Derived files never overwrite the source streams.

## Initial Done

The stage-one design is sound when it demonstrates, with synthetic/mocked
driver tests, that:

1. a literature-backed model produces a deterministic plan from a seed;
2. AX and pixel observations are represented without leaking one into the
   other condition;
3. intended and emitted input events retain separate timestamps;
4. Manhole ground truth can score a run without assisting the controller;
5. trial finalization detects missing streams and changed artifacts;
6. the Darwin implementation seam is validated against pinned Peekaboo and
   OpenAdapt revisions.

The implemented `humanish verify --artifacts DIRECTORY` command checks every
file digest covered by `terminal.json`; OpenAdapt's own nested integrity
manifest independently covers the recorder directory.

