---
stage: 1
project: kinetic
status: "built, machine-checkable Done"
done: "bash check.sh"
design: "orckits indexzero/mad-science/2026-10-kinetic (TECHNICAL.DESIGN.md, DESIGN-FINAL revision 5)"
---

# kinetic

kinetic is a preloading web player for Keynote decks, with a converter from the KPF HTML export. The converter writes a declarative `deck.json` and a `media/` directory. The player draws each word as a vector outline and keeps the next two slides decoded, so a change never waits on the network.

The first deck is `_all_docs` (71 slides). Its live export is at <https://all-docs.talks.charlie.dev/>.

## Layout

| path | what it is |
|---|---|
| `schema/deck.schema.json` | the deck format, JSON Schema draft 2020-12 |
| `convert/` | the converter: KPF fetch and cache, PDF outlines through `mutool`, media through `ffmpeg` and `pdftocairo`, effects, the `.key` string harvest, and `validate.js` |
| `convert/test/` | the unit tests (`node --test`) and their fixtures |
| `player/` | the player: plain ES modules, no bundler, no dependencies |
| `decks/_all_docs/` | the converted deck: `deck.json` and `media/` (committed) |
| `e2e/` | the Playwright suite, the static server, and the committed capture sets |
| `check.sh` | the machine-checkable Done |
| `REPORT-1.md` | the measurements of all four checkpoints |

## Convert

You need `node` 24, `pnpm` 10, `mutool`, `pdftocairo`, and `ffmpeg` on the `PATH`.

```sh
pnpm install
pnpm convert
pnpm convert --slides 1,2,4
pnpm convert --key ~/Git/indexzero/presentations/2025/_all_docs.final.key
```

- With no options, the converter reads the live export and writes `decks/_all_docs/`.
- `--slides` converts only the listed slides (1-based). Write `pnpm convert --slides 1,2,4`. Under pnpm 10, `pnpm convert -- --slides 1,2,4` fails, because pnpm forwards the literal `--`.
- `--slides` also replaces the committed `decks/_all_docs/deck.json` with a deck of only those slides. To keep the committed deck, add `--out <directory>` with a directory outside this checkout. Otherwise restore the deck with `git checkout -- decks`.
- `--kpf <url or directory>` reads another copy of the export. `--out <directory>` writes somewhere else.
- `--key <path>` adds the `.key` string harvest. It records `source.keyParse` in `deck.json`. It never gates an element.
- The first run fetches the export into `.cache/kpf/` (gitignored). Later runs are offline.
- A full run takes about 40 s from a warm cache. A run with no transcodes in `media/shared/` takes about 3 to 7 minutes.
- The output is byte-identical between two runs at one commit. `source.convertedAt` and `source.converter` are the committer date and short sha of HEAD.

## Play

```sh
node e2e/serve.js
```

Then open <http://localhost:4173/player/index.html?deck=../decks/_all_docs/deck.json#1>. Any static server works, if it sends the MIME types in `PUBLISH.md`. `PORT` sets the port of `e2e/serve.js`. `pnpm e2e` starts the same server.

- URL grammar: `player/index.html?deck=<path to deck.json>#<n>`. The path is relative to `player/`. `n` is the 1-based slide.
- Keys: ArrowRight and space advance one build step, then the slide. ArrowLeft goes back.
- `window.kinetic` exposes `isReady(n)`, `current()`, `goto(n)`, `preloaded()`, and `frameTimes()` for the suite.

## Check

```sh
bash check.sh
```

`check.sh` runs from any directory. It prints each step with its command and exit code, and the total time. It exits 0 only when every step passes. The steps are the tool check, `pnpm install --frozen-lockfile`, `pnpm exec playwright install chromium`, `pnpm validate`, `pnpm test`, the font grep, `pnpm e2e`, and `git status --porcelain` on this directory. A full run takes 30 to 50 minutes on the build Mac, because the suite captures all 71 slides from the live export.

`pnpm e2e` writes every capture, `ratios.json`, `preload.json`, and `spike-bench.json` under `e2e/captures/out/` (gitignored). The committed sets in `e2e/captures/` are references. A run never rewrites them, so the tree stays clean. To update the committed sets on purpose, set the flag:

```sh
KINETIC_UPDATE_CAPTURES=1 pnpm e2e --grep spike
```

## Tolerance

- A capture compares the live export and the new player at 960x540 with `pixelmatch` 8.0.0 at threshold 0.1.
- The tolerance is 3 percent of the compared pixels (`e2e/tolerance.json`, `default` 0.03). The design set it. The spike measured three ratios below 0.001. The default was kept, not tightened.
- No slide has an override. The largest ratio of the last full run is 0.01912, on slide 52.
- A video box is masked on both sides, because the live player plays a GIF as an `<img>` that cannot be paused.
- Where the video boxes cover the frame or overlap a text box, the suite masks the pixels that move on either side instead. That is rule `animated-pixels-masked`. On glyph pixels only the motion of the live side counts.

## Known limits

- Vacuous masks. The `spike-2` box mask covers the whole frame, so that ratio has no pixels. The suite also compares the final state of slide 2 with no mask. Forty-four slides take rule `animated-pixels-masked` for the same reason or for a text overlap.
- Orphans. Zero hidden elements lack a build step.
- Fallbacks. No text page fell back to a raster. No effect fell back to `appear`. Three picture pages are 1x rasters, and 70 take their embedded image stream. `source.path` is `key` 0, `pdf` 599, `texture` 235. The `key` count is 0 because the harvest has no run-to-font link.
- WebM. The player picks WebM (VP9) where the browser can play it, and MP4 (H.264) otherwise. No GIF has alpha, so no WebM carries alpha. Before checkpoint 4, two converts wrote WebM files that differed in 16 bytes (the Matroska track UID). The `-fflags +bitexact` flag removes that difference.
- Preload waivers. At 1.5 Mbit/s, 10 slides cannot preload n+1 and n+2 within 10 s. Their pending media needs more time than that by its transfer floor alone. For n = 1, 2, 10, 13, 44, 47, 48, 62, 67, and 68, the spec asserts the floor plus 10 s. It records each waiver in `preload.json`.
- First slide. Under the throttle the first slide draws about 67 s after navigation, because `deck.json` is 12.4 MB. `PUBLISH.md` names compression as a hosting step.

## Report

`REPORT-1.md` holds the census, the measurements, and the Done list of each checkpoint.
