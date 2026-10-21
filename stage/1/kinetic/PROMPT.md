---
stage: 1
project: kinetic
provenance: reconstructed
source: "TECHNICAL.DESIGN.md of the orckits run indexzero/mad-science/2026-10-kinetic, revision 5"
original: "chat uuid c625761d, not recovered; see the run's QUESTIONS.md Q-003"
corrections:
  - "The per-slide file is assets/<UUID>/<UUID>.json (verified in assets/player/main.js, downloadSlide)."
  - "The font availability table below replaces the chat's unknown font inventory."
---

# Rebuild the _all_docs talk as a preloading web player

## Task

You rebuild the `_all_docs` Keynote talk as a preloading web player. The project lives at `stage/1/kinetic/` in `indexzero/mad-science`.

The owner has fifteen years of Keynote decks in one style. They have image or GIF backgrounds. Text builds in word by word from different directions. Push transitions rotate clockwise. Keynote exports a deck to HTML (the KPF player), and the owner hosts that export as static files. The KPF player fetches each slide when it is reached, so every slide change stalls on the network.

Build three things:

1. A declarative deck format, `schema/deck.schema.json` (JSON Schema draft 2020-12). A slide is a list of elements and a list of build steps. A text element is a list of words, and each word is a vector outline.
2. A converter, `convert/`. It reads the KPF export (and the `.key` where the parse succeeds). It writes `decks/_all_docs/deck.json` and `decks/_all_docs/media/`.
3. A browser player, `player/`. It preloads slides N+1 and N+2. "Slide N is ready" is one predicate, `isReady(n)`. It draws text as `Path2D` words on a canvas and plays the build and transition vocabulary that the census finds.

Then prove it. A Playwright suite compares the new player to the live export slide by slide.

The inputs:

- The live export: <https://all-docs.talks.charlie.dev/>. Fetch from there. Never write to it.
- The deck: `2025/_all_docs.final.key` in `~/Git/indexzero/presentations` (268 MB, LFS present). Read that checkout. Never write to it.
- The fonts on disk: `~/Git/indexzero/presentations/assets/fonts/`. Read the names only. Never copy a font file.

## The per-slide file

Each slide of the export is `assets/<UUID>/<UUID>.json`. The live player builds that path in `assets/player/main.js` (`downloadSlide(A){var B="./assets/"+A+"/"+A+".json"`). `assets/header.json` lists the 71 slide UUIDs in `slideList`. A slide JSON has an `assets` map (textures and videos) and an `events` list. Each texture is one page of a per-slide PDF, with the deck's fonts embedded as TrueType subsets. Take the word outlines from those PDF pages with `mutool draw -F svg -O text=path`.

## Font availability

| Font family named in `header.json` | PostScript names | In `presentations/assets/fonts/` | Consequence |
|---|---|---|---|
| Ostrich Sans | `OstrichSans-Bold` | present (9 files) | `key` path possible |
| Blanch | `Blanch-CapsLight` | present (6 files) | `key` path possible |
| GT Walsheim | `GTWalsheimRegular` | present (5 files, Office cut) | `key` path possible |
| Museo Sans | `MuseoSans-100` | present (10 files) | `key` path possible |
| GD Boing | `GDBoing-Bold` | present (2 files) | `key` path possible |
| Geist Mono | 9 cuts | absent | `pdf` path |
| Avenir, Avenir Next | 7 cuts | absent | `pdf` path |
| Helvetica Neue, Helvetica | 6 cuts | absent | `pdf` path |
| Graphik | 3 cuts | absent | `pdf` path |
| Produkt | 2 cuts | absent | `pdf` path |
| DIN | `DINCondensed-Bold`, `DINAlternate-Bold` | absent | `pdf` path |
| Futura | `Futura-Medium` | absent | `pdf` path |
| Tw Cen MT, Calibri, Menlo, Arial, Gill Sans | 8 cuts | absent | `pdf` path |

`GDSherpa-Bold.otf` is on disk and not named in `header.json`. Never ship it. Its license is the owner's decision.

Every text element records the path it took in `source.path`: `key`, `pdf`, or `texture`.

## Checkpoints

Work in four checkpoints. Each one ends with a commit on branch `1/kinetic` and a pause for the owner's decision point. If the owner is away, take the default and continue.

| Checkpoint | Deliverable | Owner decision point | Default if the owner is away |
|---|---|---|---|
| 1 Discovery | `REPORT-1.md`: per-slide layout, texture formats, GIF representation, effect census with counts, `.key` parse result, font table, hash grammar of the live player, media size projection, the three spike slides named, the tolerance set. `schema/deck.schema.json` draft. `package.json`, `convert/kpf.js`, `convert/test/`. | Confirm the three spike slides and the parse-or-textures choice. | Spike: slide 4 (word-by-word `apple:move in`), slide 2 (GIF `thinking-wilder`), and the push from slide 1 to 2. Parse: try it, and fall back per element. |
| 2 Spike | The converter for the three slides. The player with `move-in`, `push`, and `video`. Side-by-side captures. `pnpm test` green. | none | |
| 3 Vocabulary and all 71 | Every census effect mapped. All 71 slides converted and captured. The preload spec green under throttling. The GIF transcode and its byte table. | Approve the tolerance and the fallback counts before publish preparation. | Continue to checkpoint 4 with the counts in `REPORT-1.md`. |
| 4 Done | `check.sh`. `README.md`. `PROMPT.md`. Publish notes (what to upload, with no upload). | Publish. | Never done by you. |

Gall's Law governs the order. The spike is three slides and one effect each. The full vocabulary grows from a spike that works.

## Constraints

- No font file in the output. `check.sh` fails on any `.ttf`, `.otf`, `.woff`, `.woff2`, or `.cff`.
- No write to the live site or to any bucket. Checkpoint 4 prepares a publish. The owner publishes.
- Gall's Law: start from the smallest system that works, and grow it.
- No em dashes in any document you write.
- Transcode each GIF to MP4 and WebM with `ffmpeg`, and record the `ffmpeg` version.
- Keep each media file at 20 MB or less and the whole `media/` at 200 MB or less.
- Write short sentences. Put document metadata in YAML frontmatter.

## Done

The project is done when every item below holds. The six success criteria are quoted from the run's problem statement:

> - `REPORT-1.md` exists with the census table and the font table (Ostrich Sans, Blanch, GT Walsheim, Museo Sans, GD Boing present in `presentations/assets/fonts/`; Geist Mono, Avenir, Helvetica Neue, Graphik, Produkt, DIN, Futura absent).
> - Three spike slides (one word-by-word build, one GIF background, one push) play and their captures match the live export within the tolerance the report sets.
> - All 71 slides play with no visible stall under Playwright network throttling; slides N+1 and N+2 are preloaded.
> - No font file is in the output. Each text element records which path it took (key, PDF, texture).
> - `bash stage/1/kinetic/check.sh` exits 0.
> - The GIF to MP4 and WebM transcode exists and the ledger notes that presentations#6 can close with it.

And `bash check.sh` in `stage/1/kinetic/` exits 0.
