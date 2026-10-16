# Experimental treatments

The first experiment tells two stories at once: it evaluates quantitative HCI
models, and it makes the historical assumptions of desktop automation
measurable.

## Factorization

Machine treatments vary three independent factors:

| Factor | Levels |
|---|---|
| Trajectory | Peekaboo linear; Peekaboo human |
| Motor timing | fixed legacy duration; Shannon-form Fitts duration |
| Cognitive schedule | none; KLM/GOMS `M P K` schedule |

This prevents a curved trajectory from being mistaken for a cognitive model,
or Fitts-scaled duration from being attributed to Peekaboo's path generator.
The manifest stores every factor and its parameters.

## Prior-art controls

| Treatment ID | Interpretation |
|---|---|
| `peekaboo-linear` | A useful stand-in for classic destination-driven automation: linear path, fixed 500 ms movement, no cognitive schedule. |
| `peekaboo-human` | Contemporary human-styled automation: Peekaboo's seeded curve/jitter/overshoot/settling heuristics, fixed 500 ms movement, no cognitive schedule. This is the first executable baseline. |

The historical labels describe automation styles, not release dates asserted
about the Peekaboo project itself.

## Research treatments

| Treatment ID | Trajectory | Motor timing | Cognitive schedule |
|---|---|---|---|
| `peekaboo-human-fitts` | human | Fitts | none |
| `peekaboo-human-fitts-goms` | human | Fitts | KLM/GOMS |
| `peekaboo-linear-fitts` | linear | Fitts | none |
| `peekaboo-linear-fitts-goms` | linear | Fitts | KLM/GOMS |

The initial Fitts parameters are Raskin's explicitly rough values from *The
Humane Interface*, section 4-4: `a = 50 ms`, `b = 150 ms/bit`, with
`ID = log2(1 + D/W)`. For two-dimensional targets, the first approximation
uses the smaller target dimension. KLM defaults are `M = 1.35 s`, `K = 0.2 s`,
and `H = 0.4 s`; the pointing duration `P` is supplied by Fitts in the research
treatments. These are starting hypotheses, not universal human constants.

## Human baseline

Human sessions are the ground-truth condition. Recruitment must deliberately
span pointing ability, age, motor/accessibility needs, browser familiarity,
and familiarity with click-to-explore interfaces. Participant breadth,
exclusions, device settings, and within-person learning order must be reported;
an undifferentiated average of convenient experts is not a sufficient human
baseline.

The autonomous phase precedes recruitment. It validates instrumentation and
compares machine distributions to audited primary literature datasets. It may
not be described as a human-equivalence result.
