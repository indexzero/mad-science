# Humanish computer-use research harness

## Confirmed intent

- **Outcome:** Build a serious Darwin computer-use research harness that can
  eventually drive arbitrary web pages with complex a11y selectors and compare what is measurably
  "humanish."
- **Research conditions:** Support three comparable conditions: a human user,
  pixel-only computer use, and accessibility-assisted computer use.
- **First implementation:** Begin with accessibility-assisted control, selected
  after surveying existing open-source computer-use systems rather than
  rebuilding the substrate unnecessarily.
- **First experiment:** Externally control a browser running a newly authored,
  instrumented Manhole-style web application. Preserve the original's
  interaction grammar, scene topology, clickable-hotspot behavior, and visual
  discovery characteristics while using newly authored assets and a
  configurable scene graph.
- **Measurement:** Turn Fitts, GOMS, KLM, interface-efficiency, and familiarity
  models into executable hypotheses. Initially compare their predictions with
  timing distributions from published HCI literature. Record synchronized
  screenshots, input events, timing, target geometry, misses, exploration,
  transitions, and outcomes.
- **Success:** The harness autonomously performs and evaluates the Manhole
  experiment while its controller, recorder, and research models remain
  reusable for substantially more sophisticated applications. The browser is
  the first arbitrary application under test, not the architectural boundary.
- **Constraint:** Browser accessibility may assist the first controller, but
  must not become an architectural dependency that prevents later pixel-only
  experiments. Darwin is the only required operating system for the first
  release.

## Research premise

"Intuitive" is treated as readily transferred familiarity rather than an
intrinsic property of an interface. Familiarity is therefore a latent variable
that can affect method selection, help-seeking, errors, learning, and task
timing. Motor behavior alone is not a sufficient model of human interaction.

The first autonomous phase uses literature distributions rather than newly
recruited human participants. Human sessions remain a first-class experimental
condition for a later phase.
