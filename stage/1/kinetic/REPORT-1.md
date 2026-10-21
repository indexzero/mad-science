---
checkpoint: 4
date: "2026-10-21"
deck: "presentations/2025/_all_docs.final.key (268,682,708 bytes, read-only)"
live_export: "https://all-docs.talks.charlie.dev/"
design: "orckits indexzero/mad-science/2026-10-kinetic/TECHNICAL.DESIGN.md, DESIGN-FINAL revision 5 (checkpoint 1 was written against revision 3)"
tools:
  node: "v24.16.0"
  pnpm: "10.34.0"
  mutool: "1.28.2"
  pdftocairo: "26.08.0"
  ffmpeg: "9.0.1"
  ajv: "8.20.0"
  playwright: "1.64.1"
  pixelmatch: "8.0.0"
  pngjs: "7.0.0"
ffmpeg: "9.0.1"
evidence: "orckits indexzero/mad-science/2026-10-kinetic/sslop/D-004/ (census, texturetype, textures, push, key, media)"
---

# REPORT-1: discovery of the `_all_docs` KPF export

Checkpoint 1 of the kinetic project. Every number below comes from a command run on 2026-10-20 against the live export and the `.key`. The commands are `convert/census.js`, `convert/pdf.js`, `convert/key.js`, and the scratch scripts named in the frontmatter. Where a number differs from TECHNICAL.DESIGN.md, the section says so.

## Per-slide layout

Source: `node convert/census.js` over all 71 slides. `scenes` is `events.length`. `textures` and `videos` count the slide's `assets` by type. `transition` and `direction` come from the one top-level `transition` effect. `top-level builds` lists the top-level `buildIn` effect names in order.

| # | UUID | scenes | textures | videos | transition | direction | top-level builds |
|---|---|---|---|---|---|---|---|
| 1 | `C1F6FE7C` | 1 | 2 | 0 | `apple:push` | 12 | (none) |
| 2 | `59BDD422` | 2 | 7 | 1 | `apple:push` | 11 | `apple:movie-start` |
| 3 | `EB444FF3` | 3 | 16 | 5 | `apple:push` | 11 | `apple:movie-start`, `apple:movie-start`, `apple:movie-start`, `apple:movie-start`, `apple:movie-start`, `apple:move in` |
| 4 | `88910011` | 3 | 17 | 0 | `apple:push` | 12 | `apple:move in`, `apple:move in`, `apple:dissolve character`, `apple:move in`, `apple:move in` |
| 5 | `73C7442D` | 2 | 13 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 6 | `C459B829` | 2 | 6 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 7 | `3ECD48CC` | 2 | 15 | 1 | `apple:push` | 14 | `apple:movie-start` |
| 8 | `0989231F` | 2 | 7 | 1 | `none` | 0 | `apple:movie-start` |
| 9 | `0FF57334` | 2 | 8 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 10 | `0A2D9D69` | 2 | 7 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 11 | `38E207A6` | 2 | 9 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 12 | `AFB598FC` | 2 | 10 | 0 | `apple:push` | 12 | `apple:move in` |
| 13 | `3F433607` | 2 | 7 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 14 | `7A0A931F` | 2 | 7 | 1 | `apple:push` | 14 | `apple:movie-start` |
| 15 | `F9616D4D` | 2 | 21 | 6 | `apple:push` | 13 | `apple:movie-start`, `apple:movie-start`, `apple:movie-start`, `apple:movie-start`, `apple:movie-start`, `apple:movie-start` |
| 16 | `1C9B8733` | 2 | 8 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 17 | `E2E4B16E` | 2 | 8 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 18 | `608C7D7D` | 2 | 7 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 19 | `774840F5` | 3 | 9 | 0 | `apple:push` | 12 | `apple:move in`, `apple:move in`, `apple:move in` |
| 20 | `A73BFE42` | 2 | 7 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 21 | `43C092A1` | 2 | 12 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 22 | `D2B8AE30` | 2 | 160 | 1 | `apple:push` | 14 | `apple:movie-start` |
| 23 | `CFDCE3D1` | 1 | 2 | 0 | `apple:push` | 13 | (none) |
| 24 | `94827105` | 2 | 52 | 0 | `apple:push` | 12 | `com.apple.iWork.Keynote.LineDraw` |
| 25 | `C4D54958` | 2 | 35 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 26 | `FAF2466F` | 2 | 14 | 4 | `apple:push` | 12 | `apple:movie-start` |
| 27 | `9C46FF18` | 5 | 26 | 1 | `apple:push` | 14 | `apple:movie-start`, `apple:move in`, `apple:move in`, `apple:move in`, `apple:move in` |
| 28 | `8934AF3E` | 2 | 5 | 0 | `apple:push` | 13 | `apple:wipe` |
| 29 | `1D13F150` | 2 | 6 | 1 | `apple:push` | 13 | `apple:movie-start` |
| 30 | `0183CC61` | 2 | 18 | 5 | `apple:push` | 14 | `apple:movie-start`, `apple:movie-start`, `apple:movie-start` |
| 31 | `5D3D3A51` | 1 | 2 | 0 | `apple:push` | 12 | (none) |
| 32 | `C6765084` | 2 | 8 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 33 | `329FF88F` | 2 | 9 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 34 | `8D012EB6` | 4 | 11 | 1 | `apple:push` | 12 | `apple:movie-start`, `apple:dissolve`, `apple:move in` |
| 35 | `E7756255` | 2 | 6 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 36 | `351C44E6` | 2 | 8 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 37 | `C000D0BF` | 2 | 8 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 38 | `917E6853` | 2 | 8 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 39 | `D6004B35` | 2 | 28 | 0 | `apple:push` | 14 | `apple:move in` |
| 40 | `9AFBF5A5` | 2 | 14 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 41 | `7B44BD7D` | 2 | 9 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 42 | `50321FA4` | 2 | 13 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 43 | `B66785DB` | 1 | 2 | 0 | `apple:push` | 12 | (none) |
| 44 | `BEC709A9` | 1 | 2 | 0 | `apple:push` | 12 | (none) |
| 45 | `B9585C7A` | 2 | 8 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 46 | `4AAC520D` | 7 | 25 | 5 | `apple:push` | 13 | `apple:movie-start`, `apple:move in`, `apple:move in`, `apple:move in`, `apple:move in`, `apple:move in` |
| 47 | `07EC1217` | 2 | 15 | 4 | `apple:push` | 12 | `apple:movie-start` |
| 48 | `6837879D` | 2 | 6 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 49 | `1D96BCCD` | 2 | 16 | 6 | `apple:push` | 12 | `apple:movie-start` |
| 50 | `F32AD8AA` | 3 | 11 | 0 | `apple:push` | 14 | `apple:move in`, `apple:move in` |
| 51 | `604F7114` | 2 | 8 | 0 | `apple:push` | 12 | `apple:move in character` |
| 52 | `F39DAB15` | 2 | 7 | 0 | `apple:push` | 12 | `apple:move in` |
| 53 | `33D008DA` | 1 | 2 | 0 | `apple:push` | 12 | (none) |
| 54 | `3FE517E3` | 1 | 2 | 0 | `apple:push` | 12 | (none) |
| 55 | `C4C86335` | 2 | 8 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 56 | `6A866C13` | 2 | 14 | 3 | `apple:push` | 12 | `apple:movie-start` |
| 57 | `A0E38D7D` | 4 | 13 | 1 | `apple:push` | 11 | `apple:movie-start`, `apple:move in`, `apple:move in` |
| 58 | `F7544D84` | 3 | 9 | 0 | `apple:push` | 12 | `apple:move in`, `apple:move in` |
| 59 | `83449CA2` | 2 | 14 | 4 | `apple:push` | 12 | `apple:movie-start` |
| 60 | `1A3239D9` | 2 | 8 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 61 | `8EBF2AE4` | 1 | 2 | 0 | `apple:push` | 12 | (none) |
| 62 | `26589083` | 1 | 2 | 0 | `apple:push` | 12 | (none) |
| 63 | `281E9A46` | 1 | 2 | 0 | `apple:push` | 12 | (none) |
| 64 | `053C002C` | 2 | 16 | 5 | `apple:push` | 12 | `apple:movie-start` |
| 65 | `7D21026C` | 6 | 17 | 1 | `apple:push` | 12 | `apple:movie-start`, `apple:move in`, `apple:move in`, `apple:move in`, `apple:move in` |
| 66 | `6862C3C5` | 2 | 8 | 0 | `apple:push` | 12 | `apple:wipe`, `apple:move in character` |
| 67 | `E300C36D` | 2 | 6 | 1 | `apple:push` | 12 | `apple:movie-start` |
| 68 | `8A8314F5` | 2 | 10 | 0 | `apple:push` | 12 | `apple:move in` |
| 69 | `65DB4198` | 3 | 33 | 0 | `apple:push` | 12 | `apple:move in`, `apple:move in` |
| 70 | `F75F84FB` | 3 | 20 | 6 | `apple:push` | 12 | `apple:movie-start`, `apple:move in` |
| 71 | `3496F91D` | 2 | 6 | 1 | `apple:push` | 12 | `apple:movie-start`, `apple:move in character` |

Totals: 71 slides, 155 scenes, 937 textures, 90 videos.

## Texture formats

Source: `sslop/D-004/textures/scan.mjs`, which runs `pageToSvg` and `parseSvg` over every page of every slide PDF (937 texture pages, 71 PDFs, 49,861,810 bytes of PDF). Every texture is one page of its slide's PDF. The class rules follow. A video poster is the `isVideoLayer` texture. `textureType` 0 is a snapshot. `textureType` 1 is a background. A page with one or more `<use>` placements is text. A page with no placements and one or more `<image>` is a picture. A page with only body paths is a shape.

| class | pages | at 1920x1080 | `<use>` total | `<image>` total | SVG bytes | what it is |
|---|---|---|---|---|---|---|
| text | 415 | 0 | 7,505 | 99 | 4,533,498 | glyph placements; becomes `kind: text` with `source.path: pdf` or `key` |
| picture | 167 | 1 | 0 | 194 | 32,129,769 | a raster; becomes `kind: image` with `source.path: texture` |
| snapshot | 141 | 141 | 18,299 | 421 | 61,254,992 | full-slide composite that the push transition and the scene cache draw; never an element |
| video poster | 90 | 1 | 0 | 90 | 9,342,819 | the first frame of a GIF, drawn under the `<img>`; becomes the video `poster` |
| shape | 64 | 1 | 0 | 0 | 301,260 | vector rectangles or rules with no glyph and no raster |
| background | 60 | 60 | 0 | 0 | 21,840 | the slide fill; becomes `Slide.background` |

Cross-tabulation of `textureType` against the class:

| textureType | class | pages |
|---|---|---|
| 6 | text | 251 |
| 5 | picture | 167 |
| 5 | text | 164 |
| 0 | snapshot | 141 |
| - | video poster | 90 |
| 5 | shape | 63 |
| 1 | background | 60 |
| 1/0 | shape | 1 |

- Text pages that also carry an `<image>`: 41. These keep the outlines and lose the raster in checkpoint 2 unless the spike shows the raster matters.
- Projected `source.path` counts: `pdf` or `key` for the 415 text pages, `texture` for the 167 picture pages. The 141 snapshots and the 60 backgrounds are not elements.
- Design fact 7 says 204 of 937 textures are 1920x1080. The scan agrees: 141 snapshots, 60 backgrounds, and one each of picture, poster, and shape.

## GIF representation

Source: the video census in `convert/census.js`, with every placement fetched through the cache and hashed.

| field | value |
|---|---|
| placements (`renderMovie` effects with `movie`) | 90 |
| slides with video | 48 |
| max placements per slide | 6 |
| distinct basenames | 73 |
| distinct URL paths | 90 |
| widest placement (px) | 642 |
| distinct by sha256 of bytes | 73 |
| bytes, distinct GIFs | 168152577 |
| bytes, all placements | 207305667 |

Largest distinct GIFs:

| sha256-12 | bytes | placements | basenames |
|---|---|---|---|
| `c0de2c644e86` | 12619759 | 1 | `seen-things.gif-0.0000-8.2500.gif` |
| `16e9e587d147` | 10090326 | 1 | `brooklyn99-papers.gif-0.0000-6.0600.gif` |
| `7b841497aff9` | 9432988 | 1 | `it-could-work.gif-0.0000-5.8000.gif` |
| `c9cced4b0ea5` | 7832519 | 1 | `thinking-wilder.gif-0.0000-5.3900.gif` |
| `80d5734cad33` | 7778774 | 1 | `Air Pollution Nyc GIF by Njorg.gif-0.0000-6.7200.gif` |
| `aa383b9c8acb` | 7617051 | 4 | `Earth Planet GIF by National Institute of Standards and Technology (NIST).gif-0.0000-5.7200.gif` |
| `cddd415d2d3f` | 5276820 | 1 | `confused.gif-0.0000-2.5200.gif` |
| `bd6561d2e1e0` | 5240950 | 1 | `thank-you-creek.gif-0.0000-1.9100.gif` |
| `2d2d3df44ac2` | 4983623 | 1 | `water splashing GIF.gif-0.0000-12.0000.gif` |
| `899d4dc037eb` | 4506188 | 1 | `made-myself-sad.gif-0.0000-4.0000.gif` |

- A GIF placement is a `renderMovie` effect nested under `apple:movie-start`, with `movie.asset` naming the video asset and `movie.loopMode` `looping`. The layer that carries it has `isVideoLayer: true` and its `texture` is a PDF page (the poster frame), not the GIF.
- All 90 placements resolve to 73 distinct files by sha256, which is also the count of distinct basenames. No two basenames share bytes. 6 GIFs appear on more than one slide (`Earth Planet GIF by National Institute of Standards and Technology (NIST)` x4, `limbo-hermes` x4, `externals-box` x2, `scorpio` x5, `Question Mark Mario GIF` x5, `Funny Money GIF` x3).
- Bytes: 168,152,577 over the 73 distinct GIFs, 207,305,667 if every placement were fetched. The live export serves the GIF bytes per slide directory, so a viewer who sees all 71 slides downloads the larger number.
- The live player renders a GIF as an `<img>` (`initAnimatedImage`), never a `<video>`. It cannot be paused. The capture masks the video box (see Tolerance).

## Effect census

Two populations, as the design requires. Top-level is `events[].effects[]`; it carries `attributes.direction`. Recursive includes every nested `effects[].effects[]`.

| transition | count |
|---|---|
| `apple:push` | 70 |
| `none` | 1 |

| buildIn | count |
|---|---|
| `apple:movie-start` | 59 |
| `apple:move in` | 35 |
| `apple:move in character` | 3 |
| `apple:wipe` | 2 |
| `apple:dissolve` | 1 |
| `apple:dissolve character` | 1 |
| `com.apple.iWork.Keynote.LineDraw` | 1 |

| name | count |
|---|---|
| `apple:move in` | 153 |
| `apple:movie-start` | 90 |
| `renderMovie` | 90 |
| `apple:push` | 70 |
| `apple:dissolve` | 25 |
| `apple:move in character` | 14 |
| `apple:wipe` | 10 |
| `apple:keyboard` | 8 |
| `apple:dissolve character` | 4 |
| `com.apple.iWork.Keynote.LineDraw` | 3 |
| `apple:fade and move` | 2 |
| `apple:appear` | 1 |
| `apple:bc-appear` | 1 |
| `none` | 1 |

| direction | slides |
|---|---|
| `11` | 3 |
| `12` | 55 |
| `13` | 5 |
| `14` | 7 |

Every count equals TECHNICAL.DESIGN.md fact 5. The appendix mapping of the design, with the recursive counts:

| KPF name | kinetic effect | unit | recursive count | top-level count |
|---|---|---|---|---|
| `apple:move in` | `move-in` | object or word | 153 | 35 |
| `apple:move in character` | `move-in` | character | 14 | 3 |
| `apple:dissolve` | `dissolve` | object | 25 | 1 |
| `apple:dissolve character` | `dissolve` | character | 4 | 1 |
| `apple:wipe` | `wipe` | object | 10 | 2 |
| `apple:keyboard` | `keyboard` | character | 8 | 0 |
| `apple:appear`, `apple:bc-appear` | `appear` | object | 2 | 0 |
| `apple:fade and move` | `fade-and-move` | object | 2 | 0 |
| `com.apple.iWork.Keynote.LineDraw` | `line-draw` | object | 3 | 1 |
| `renderMovie`, `apple:movie-start` | `movie-start` | object | 90 + 90 | 59 |
| `apple:push` | `push` | slide | 70 | 70 |
| `none` | `none` | slide | 1 | 1 |

Layer state, both populations, for the converter rules in the design's Deck format section:

| field | count |
|---|---|
| layers, all baseLayers, all depths | 5095 |
| layers under `events[].baseLayer` only | 3034 |
| texturedRectangle leaves, all baseLayers | 1998 |
| texturedRectangle leaves under `events[].baseLayer` only | 1172 |
| hidden texturedRectangle leaves, all baseLayers | 1174 |
| hidden texturedRectangle leaves under `events[].baseLayer` only | 580 |
| `isVideoLayer` layers | 90 |
| `opacity` below 1, all baseLayers | 17 |
| `opacity` below 1 under `events[].baseLayer` only | 15 |
| `sublayerTransform` identity, all baseLayers | 4359 |
| `sublayerTransform` with one perspective term (m34), all baseLayers | 736 |
| `sublayerTransform` with one perspective term under `events[].baseLayer` only | 71 |
| `sublayerTransform` other | 0 |
| `masksToBounds` true | 0 |
| `edgeAntialiasingMask` values | 0: 1998, 251658240: 3097 |
| `shapePath.elements` carriers / entries | 119 / 736 |
| `repGenerationDictionary.infoShapePath` carriers / entries | 3 / 18 |
| `textColor` carriers | 616 |

The design's counts are the `events[].baseLayer` population. They are 580 hidden of 1,172 leaves, 15 layers below opacity 1, and 2,963 identity and 71 perspective `sublayerTransform`. They also include 736 `shapePath` entries and 18 `infoShapePath` entries. `masksToBounds` is false everywhere. `edgeAntialiasingMask` has two values and no effect on flat content.

## `textureType` decode

Source: `sslop/D-004/texturetype/`. Every texture page of slides 1, 2, 4, 51, and 69 is listed. Each row has the `textureType` of the leaf that references it and the `<use>` count from `parseSvg`. Plus three `textureType` 6 pages from slides 7 and 9, because the five slides carry none.

| slide | page | texture | size | textureType | isBackgroundTexture | video poster | `<use>` | glyph defs | body paths | `<image>` | words |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 0 | `DD0E5007` | 1920x1080 | 0 | false |  | 88 | 62 | 12 | 0 | OCTOBER 16TH, 2025 JSCONF NA CHARLIE ROBBINS Clo |
| 1 | 1 | `4A5B9259` | 1920x1080 | 0 | false |  | 0 | 0 | 3 | 1 |  |
| 2 | 0 | `C25C25FF` | 1920x1080 | 1 | true |  | 0 | 0 | 2 | 0 |  |
| 2 | 1 | `5DFCB3F7` | 1962x1133 | 5 | true |  | 0 | 0 | 1 | 0 |  |
| 2 | 2 | `4D000C59` | 2118x1111 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 2 | 3 | `1A0E3C95` | 1993x1126 | 5 | true |  | 115 | 26 | 2 | 0 | WARNING: THIS TALK CONTAINS MOVING & FLASHING IM |
| 2 | 4 | `D97C61E0` | 2118.30x1110.93 | - | - | yes | 0 | 0 | 0 | 1 |  |
| 2 | 5 | `8D717B78` | 1920x1080 | 0 | false |  | 115 | 26 | 5 | 1 | WARNING: THIS TALK CONTAINS MOVING & FLASHING IM |
| 2 | 6 | `20D4F8C6` | 1920x1080 | 0 | false |  | 46 | 34 | 7 | 5 | Cloud Native Registry _all_docs towards a at edg |
| 4 | 0 | `5BA6FFBB` | 1920x1080 | 1 | true |  | 0 | 0 | 2 | 0 |  |
| 4 | 1 | `F2BC9C96` | 223x270 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 4 | 2 | `DF17F393` | 471x459 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 4 | 3 | `561B1BE3` | 502x265 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 4 | 4 | `C7F42900` | 417x279 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 4 | 5 | `F92AD770` | 464x405 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 4 | 6 | `6DADC276` | 476x633 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 4 | 7 | `69FB267C` | 503x269 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 4 | 8 | `E870708A` | 416x279 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 4 | 9 | `07D462D3` | 489x376 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 4 | 10 | `C9856CF9` | 1001x554 | 5 | true |  | 0 | 0 | 0 | 2 |  |
| 4 | 11 | `F3F1815A` | 454x303 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 4 | 12 | `073A0716` | 1938x1094 | 5 | true |  | 0 | 0 | 1 | 0 |  |
| 4 | 13 | `DCEA9E7D` | 2071x492 | 5 | true |  | 11 | 10 | 3 | 0 | wisdom The |
| 4 | 14 | `EAA9333C` | 2071x491 | 5 | true |  | 15 | 13 | 5 | 0 | mikeal rogers of |
| 4 | 15 | `55E6C056` | 1920x1080 | 0 | false |  | 26 | 19 | 11 | 12 | wisdom The mikeal rogers of |
| 4 | 16 | `84DE19BE` | 1920x1080 | 0 | false |  | 0 | 0 | 3 | 1 |  |
| 51 | 0 | `5BA6FFBB` | 1920x1080 | 1 | true |  | 0 | 0 | 2 | 0 |  |
| 51 | 1 | `E13A46F6` | 2004x1090 | 5 | true |  | 0 | 0 | 1 | 0 |  |
| 51 | 2 | `32237B69` | 836x826 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 51 | 3 | `34F7AFA1` | 1183x730 | 5 | true |  | 215 | 40 | 1 | 2 | A schematic of the layout of metadata within non |
| 51 | 4 | `64C47402` | 1948x147 | 5 | true |  | 37 | 21 | 1 | 0 | This is what Climate Data looks like |
| 51 | 5 | `7EE00C85` | 1960x133 | 5 | true |  | 30 | 13 | 2 | 0 | AND THIS IS HOW IT WORKS TODAY |
| 51 | 6 | `44B0236A` | 1920x1080 | 0 | false |  | 282 | 72 | 7 | 3 | A schematic of the layout of metadata within non |
| 51 | 7 | `B291C957` | 1920x1080 | 0 | false |  | 0 | 0 | 3 | 4 |  |
| 69 | 0 | `C25C25FF` | 1920x1080 | 1 | true |  | 0 | 0 | 2 | 0 |  |
| 69 | 1 | `F2BC9C96` | 223x270 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 2 | `DF17F393` | 471x459 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 3 | `561B1BE3` | 502x265 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 4 | `C7F42900` | 417x279 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 5 | `F92AD770` | 464x405 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 6 | `6DADC276` | 476x633 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 7 | `3827BB08` | 503x269 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 8 | `E870708A` | 416x279 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 9 | `07D462D3` | 489x376 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 10 | `C9856CF9` | 1001x554 | 5 | true |  | 0 | 0 | 0 | 2 |  |
| 69 | 11 | `F3F1815A` | 454x303 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 12 | `073A0716` | 1938x1094 | 5 | true |  | 0 | 0 | 1 | 0 |  |
| 69 | 13 | `DCEA9E7D` | 2071x492 | 5 | true |  | 11 | 10 | 3 | 0 | wisdom The |
| 69 | 14 | `EAA9333C` | 2071x491 | 5 | true |  | 15 | 13 | 5 | 0 | mikeal rogers of |
| 69 | 15 | `94CCEA37` | 756x505 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 16 | `553EDDB8` | 503x337 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 17 | `E0BE15D2` | 503x337 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 18 | `2868EC64` | 503x336 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 19 | `5306F7CF` | 503x336 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 20 | `D0DB65D2` | 503x336 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 21 | `1B6C256E` | 503x337 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 22 | `703F8E40` | 657x438 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 23 | `CC383088` | 610x408 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 24 | `8F898203` | 503x336 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 25 | `EDC8CEC7` | 499x333 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 26 | `BF614A77` | 666x444 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 27 | `EBA05775` | 647x432 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 28 | `10B920E9` | 647x432 | 5 | true |  | 0 | 0 | 0 | 1 |  |
| 69 | 29 | `4A136FD8` | 973x806 | 5 | true |  | 39 | 18 | 5 | 0 | FEDERATED REGISTRY OF {SOME,SIGNED} THINGS? |
| 69 | 30 | `D593394D` | 1093x806 | 5 | true |  | 64 | 19 | 5 | 0 | GET ALL THE CONTRIBUTORS TOGETHER AND TALK ABOUT |
| 69 | 31 | `2C5CA715` | 1920x1080 | 0 | false |  | 129 | 44 | 21 | 24 | wisdom The mikeal rogers of FEDERATED REGISTRY O |
| 69 | 32 | `8F623940` | 1920x1080 | 0 | false |  | 0 | 0 | 2 | 6 |  |

`textureType` 6 samples (`sslop/D-004/texturetype/s7-tt6-p11.svg`, `s7-tt6-p12.svg`, `s9-tt6-p5.svg`): slide 7 page 10, 550x67, `textColor` white, 18 placements, `no package malware`. Slide 7 page 11, 492x67, 15 placements, `where npm means`. Slide 9 page 4, 1612x199, `textColor` orange, 15 placements, `energy storage`.

Decode:

| textureType | meaning | evidence | converter rule |
|---|---|---|---|
| 0 | full-slide snapshot, 1920x1080, `isBackgroundTexture` false | every `0` page is 1920x1080 and composites the slide's glyphs and images (141 pages deck-wide) | not an element; the player composites itself |
| 1 | slide background fill | every `1` page has 0 placements, 0 images, 2 body rectangles (60 pages) | `Slide.background` from the rectangle fill |
| 5 | an object texture: text, picture, or shape | 164 text pages, 167 picture pages, 63 shape pages deck-wide; the `<use>` count decides | `<use>` > 0: `kind: text`; `<image>` > 0 and no `<use>`: `kind: image` |
| 6 | text with a `textColor` | all 616 leaves carry `textColor`; every sampled page has placements and no image | `kind: text`; `fill` from `textColor` when the SVG fill disagrees |

Which values are text: 6 always. 5 when the page has placements. 0 and 1 never.

## Live player grammar

Source: `assets/player/main.js` (2,373,965 bytes) fetched to `sslop/D-004/reanchor/main.js`.

The startup reads the hash first, then the query:

```js
e=document.URL.split("?")[0].split("#");if(e[1]&&(Q=parseInt(e[1])),Q)B=Q;else{var t,o=i("currentSlide");t=o?parseInt(o):1,B=this.scriptManager.sceneIndexFromSlideIndex(t-1)}
```

The query reader:

```js
function i(A){A=A.replace(/[\[]/,"\\[").replace(/[\]]/,"\\]");const B=new RegExp("[\\?&]"+A+"=([^&#]*)").exec(window.location.href);return null==B?"":B[1]}
```

- `#<n>` is a 0-based scene index. Scene 0 is falsy and falls through to the query. The hash is read from `document.URL.split("?")[0]`, so it must precede any `?`.
- `?currentSlide=<n>` is a 1-based slide index, mapped by `sceneIndexFromSlideIndex(n-1)`.
- `grep -c hashchange main.js` is 0 and `grep -c popstate main.js` is 0. A URL change is a full navigation.
- The slide loader: `downloadSlide(A){var B="./assets/"+A+"/"+A+".json"`.
- GIF: `/^(png|gif|heics|heic|heif)$/` selects `initAnimatedImage(){const A=this.element=document.createElement("img")`.
- Keys: `"ArrowLeft"` and `"ArrowRight"` appear twice each. The waiting indicator is `getElementById("waitingIndicator")`.
- The host answers 403 to the Python default User-Agent (`Python-urllib/3.12`) and 200 to curl's default, to `node`, and to Node's `fetch` (which sends `user-agent: node`). `convert/kpf.js` sends a browser-like agent anyway.

## Push direction decode

`main.js` defines `const U=11,K=12,k=13,J=14,H=42,p=121;` and uses them in the WebGL transitions, for example `E===k||E===J?o*=.5:i*=.5` (13 and 14 halve the height, 11 and 12 halve the width). So `main.js` settles the axis only: 11 and 12 are horizontal, 13 and 14 are vertical. The literal `apple:push` does not appear in `main.js`; the push is played from the keyframes in the slide JSON.

The slide JSON settles the screen direction. Each push transition's `baseLayer` holds two 1920x1080 snapshot layers with a `position` animation. Source: `sslop/D-004/push/push-directions.json`, all 70 pushes.

| direction | slides | incoming `from` | outgoing `to` | motion |
|---|---|---|---|---|
| 11 | 3 | {"pointX":-960,"pointY":540} | {"pointX":2880,"pointY":540} | content moves right (incoming enters from the left edge) |
| 12 | 55 | {"pointX":2880,"pointY":540} | {"pointX":-960,"pointY":540} | content moves left (incoming enters from the right edge) |
| 13 | 5 | {"pointX":960,"pointY":-540} | {"pointX":960,"pointY":1620} | content moves down (incoming enters from the top edge) |
| 14 | 7 | {"pointX":960,"pointY":1620} | {"pointX":960,"pointY":-540} | content moves up (incoming enters from the bottom edge) |

Mapping for `Slide.transition.direction` (the direction the content moves): 11 `right`, 12 `left`, 13 `down`, 14 `up`. The owner's "clockwise" is 12 (left) for 55 of 70. Every push has the same custom timing curve (control points 0.497, 0 and 0.498, 0.996) and duration 0.5 s. Checkpoint 2 confirms the mapping with the `spike-1-2` capture 200 ms into the push.

## `.key` parse result

Source: `sslop/D-004/key/` (`run.sh`, `summary.json`, `strings.txt`, `stderr.log`). Command: `timeout 600 node convert/key.js presentations/2025/_all_docs.final.key --fonts header.json --words words-s1-s4.json --budget-ms 540000`.

| field | value |
|---|---|
| attempted | yes |
| stage reached | `done` |
| zip entries | 484 (all stored, method 0; zip64 false) |
| `Index/*.iwa` entries | 100, all read |
| IWA bytes | 631,302 compressed in 110 snappy chunks, 1,488,552 decompressed |
| archives / payloads | 7,424 / 7,431 |
| strings harvested | 5,116 (1,882 distinct), length 2 to 200 |
| matches against the 20 words of slides 1 and 4 | 20 of 20 as whole tokens inside a harvested run (`OCTOBER 16TH, 2025`, `JSCONF NA`, `mikeal rogers`); 7 strings equal a word outright (`_all_docs`, `of`, `wisdom`) |
| fonts found | 43 of 43 PostScript names in `header.json`, each as an exact string |
| wall time | 2.5 s inside the process; `time -p` real 2.64 s; budget 600 s |
| errors | none |
| verdict | **key path available** for this deck |

The `.key` is 268 MB because `Data/` holds the media (378 entries). The IWA index is 631 KB. The strings carry Keynote's text runs per paragraph, so a word-by-word build appears as one run (`OCTOBER 16TH, 2025`), not as words. Checkpoint 2 matches the SVG word sequence of a text element against the runs. It marks `source.path: key` with the font when the run contains the element's words in order and the font is on disk.

## Font availability table

The design's table, each row confirmed with `ls /Users/cjr/Git/indexzero/presentations/assets/fonts/` (39 files, listed in `sslop/D-004/fonts-ls.txt`). The last column says whether the `.key` parse found every PostScript name of the row.

| Font family named in `header.json` | PostScript names | In `presentations/assets/fonts/` | Consequence | in `.key` |
|---|---|---|---|---|
| Ostrich Sans | `OstrichSans-Bold` | present (9 files: `ls` matches `OstrichSans*`) | `key` path possible | yes |
| Blanch | `Blanch-CapsLight` | present (6 files: `ls` matches `BLANCH_*`) | `key` path possible | yes |
| GT Walsheim | `GTWalsheimRegular` | present (5 files: `ls` matches `GT-Walsheim-Office-*`) | `key` path possible | yes |
| Museo Sans | `MuseoSans-100` | present (10 files: `ls` matches `MuseoSans_*`) | `key` path possible | yes |
| GD Boing | `GDBoing-Bold` | present (2 files: `ls` matches `GDBoing-*`) | `key` path possible | yes |
| Geist Mono | 9 cuts | absent (`ls` matches none for `GeistMono*`) | `pdf` path | yes |
| Avenir, Avenir Next | 7 cuts | absent (`ls` matches none for `Avenir*`) | `pdf` path | yes |
| Helvetica Neue, Helvetica | 6 cuts | absent (`ls` matches none for `Helvetica*`) | `pdf` path | yes |
| Graphik | `Graphik-Regular`, `Graphik-Semibold`, `Graphik-Light` | absent (`ls` matches none for `Graphik*`) | `pdf` path | yes |
| Produkt | `Produkt-Extralight`, `Produkt-Light` | absent (`ls` matches none for `Produkt*`) | `pdf` path | yes |
| DIN | `DINCondensed-Bold`, `DINAlternate-Bold` | absent (`ls` matches none for `DIN*`) | `pdf` path | yes |
| Futura | `Futura-Medium` | absent (`ls` matches none for `Futura*`) | `pdf` path | yes |
| Tw Cen MT, Calibri, Menlo, Arial, Gill Sans | 8 cuts | absent (`ls` matches none for `TwCen*, Calibri*, Menlo*, Arial*, GillSans*`) | `pdf` path | yes |

The design's table says 10 Geist Mono cuts and 8 Avenir cuts. `header.json` names 9 and 7, and the rows then sum to 43. The 43 names by family: Geist Mono 9, Avenir and Avenir Next 7, and Helvetica and Helvetica Neue 6. Then Tw Cen MT 4, Graphik 3, Produkt 2, and DIN 2. One name each: OstrichSans-Bold, Blanch-CapsLight, GTWalsheimRegular, MuseoSans-100, GDBoing-Bold, Futura-Medium, Calibri, Menlo-Bold, ArialMT, GillSans. `GDSherpa-Bold.otf` and `GDSherpa-Regular.otf` are on disk and not named. No font file is copied anywhere (`find` in Raw verification of the result).

## Media size projection

Source: `sslop/D-004/media/results.v2.tsv`. The rows are the five largest distinct GIFs. They were transcoded in scratch on ffmpeg 9.0.1 with the design's commands. MP4: `-movflags faststart -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -pix_fmt yuv420p -c:v libx264 -crf 23 -an`. WebM: `-vf ... -pix_fmt yuv420p -c:v libvpx-vp9 -b:v 0 -crf 32 -an`. Poster: `-frames:v 1`.

| GIF | size | frames | alpha < 255 in frame 1 | in bytes | MP4 bytes | WebM bytes | poster PNG | MP4 % | WebM % |
|---|---|---|---|---|---|---|---|---|---|
| `seen-things` | 642x263 | 165 | 0 | 12,619,759 | 318,028 | 229,045 | 157,226 | 2.5 | 1.8 |
| `brooklyn99-papers` | 498x280 | 101 | 0 | 10,090,326 | 434,994 | 347,224 | 237,526 | 4.3 | 3.4 |
| `it-could-work` | 420x261 | 145 | 0 | 9,432,988 | 191,198 | 192,958 | 76,557 | 2.0 | 2.0 |
| `thinking-wilder` | 450x236 | 77 | 0 | 7,832,519 | 168,098 | 137,722 | 142,993 | 2.1 | 1.8 |
| `Air Pollution Nyc GIF by Njorg` | 500x500 | 144 | 0 | 7,778,774 | 806,490 | 747,506 | 129,081 | 10.4 | 9.6 |

`thinking-wilder` reproduces the design's numbers (168,098 and 137,722). No sampled GIF has alpha, so WebM stays `yuv420p`.

Projection for the 73 distinct GIFs (168,152,577 bytes in), by the pooled ratios of the sample. The ratios are MP4 4.02 percent, WebM 3.46 percent, and poster 0.96 bytes per pixel over 11,491,695 pixels:

| output | projected bytes | worst case (every GIF at the Air Pollution ratio, 20.0 percent) |
|---|---|---|
| MP4, 73 files | 6,756,503 |  |
| WebM, 73 files | 5,825,664 |  |
| poster PNG, 73 files | 11,035,608 | 11,035,608 |
| video total | 23,617,775 (23.6 MB) | 44,628,104 (44.6 MB) |

Raster fallback, measured over all 167 picture pages (zero placements, one or more `<image>`, not a snapshot, not a poster) in `sslop/D-004/textures/`:

| raster source | bytes | largest file | note |
|---|---|---|---|
| `pdftocairo -png -r 144 -singlefile` (the design's command, 2x) | 278,691,735 (278.7 MB) | 9,368,093 | 187,891,280 page pixels, rendered at 4 device pixels each |
| `pdftocairo -png -r 72 -singlefile` (1x) | 103,049,605 (103.0 MB) | 3,494,802 | same pages, one device pixel per slide pixel |
| `mutool extract` of the embedded image streams, all 71 PDFs | 40,702,555 (40.7 MB) |  | 427 PNG and 58 JPEG streams, the originals Keynote embedded, upper bound (snapshot pages embed copies) |

Totals against the 200 MB budget:

| media/ layout | bytes | share of budget |
|---|---|---|
| video + 2x raster (the design as written) | 302,309,510 (302.3 MB) | 151 percent, over budget |
| video + 2x raster, worst-case GIF ratio | 323,319,839 (323.3 MB) | 162 percent, over budget |
| video + 1x raster | 126,667,380 (126.7 MB) | 63 percent |
| video + extracted image streams | 64,320,330 (64.3 MB) | 32 percent |

The 41 text pages with an embedded image are drawn as outlines. If the spike shows the raster matters, each adds one more raster element from the same table. No single file exceeds 20 MB in any layout (the largest 2x raster is 9,368,093 bytes, the largest MP4 806,490).

Verdict for Q-005: the design's 2x raster does not fit. 278.7 MB of PNG for 167 pictures is 139 percent of the budget before any video. The video side is small: 23.6 MB projected, 44.6 MB worst case. So presentations#6 can close once checkpoint 3 writes the per-GIF table. 168.2 MB of GIF becomes about 12.6 MB of MP4 plus WebM. Committed `media/` holds with one change to the Media section. One option is to rasterize pictures at 1x (`-r 72`, `Element.scale` 1, 126.7 MB total). The better option is to extract the embedded image streams with `mutool extract` and keep Keynote's own bytes. That is 64.3 MB total with no resampling, and it needs the stream to page mapping that `mutool` prints. Checkpoint 2 picks one on the spike and REPORT-1.md records it. If the design keeps `-r 144`, the fallback applies: `media/` gitignored plus a `pnpm fetch-media` step in `check.sh`.

## Spike slides

The design's defaults, each checked against the census and the SVG parse:

| spike | slide | evidence | status |
|---|---|---|---|
| word-by-word build | slide 4 `88910011-5393-44BA-A490-715036B75B22` | top-level builds: `apple:move in`, `apple:move in`, `apple:dissolve character`, `apple:move in`, `apple:move in`; 17 textures; pages 14 and 15 are text (`wisdom The`, `mikeal rogers of`) | confirmed |
| GIF background | slide 2 `59BDD422-82F7-4357-91FC-9651246E9546` | one `apple:movie-start` with nested `renderMovie` on `thinking-wilder.gif-0.0000-5.3900.gif` (450x236, 7,832,519 bytes, sha256 `c9cced4b0ea5`) | confirmed |
| push transition | slide 1 `C1F6FE7C-13D3-4213-B5B2-00EBC914A8EB` to slide 2 | slide 1 transition `apple:push` direction 12, duration 0.5 s; incoming from (2880, 540), outgoing to (-960, 540) | confirmed |

No replacement is needed. Slide 4's builds are `apple:move in` with directions 13 and 14 on the top level. A nested `apple:move in` x3 sits under the first, which is the per-word detail the player needs. Slide 2's GIF is the one the design measured. The 1 to 2 push is direction 12, the most common direction.

## Tolerance

- Default: 3 percent mismatched pixels at 960x540 after the slide settles, `pixelmatch` 8.0.0 with `threshold` 0.1, as the design states. Checkpoint 1 keeps the default. The spike measures three ratios and may tighten it.
- Video boxes are masked on both captures. The slide 2 GIF box is 450x236 at 1920x1080, 5.1 percent of the frame, so the mask is required for the default to hold. The masked region is compared against the poster with its own recorded tolerance of 60 percent, not asserted.
- Expected discrepancy sources, in order, are three. First, outline anti-aliasing: the live player rasterizes PDF, and the new player fills `Path2D`. Second, the word split on slides where `mutool` emits no space glyph. Slide 1 splits correctly with the ink-edge gap rule, and slide 4 pages 14 and 15 split correctly. Third, the GIF region.
- A slide above the tolerance is a finding with a per-slide note, never a reason to raise the default.

## Checkpoint 1 Done

| item | where |
|---|---|
| per-slide layout, 71 rows | `REPORT-1.md:25` (Per-slide layout); `convert/census.js:44` |
| texture formats | `REPORT-1.md:105` (Texture formats); `sslop/D-004/textures/scan.json` |
| GIF representation with byte totals and 73 distinct basenames | `REPORT-1.md:135` (GIF representation); `convert/census.js:275` |
| effect census, both populations, appendix mapping | `REPORT-1.md:171` (Effect census); `convert/census.js:28` |
| `textureType` decode | `REPORT-1.md:256` (`textureType` decode); `sslop/D-004/texturetype/texturetype.json` |
| live player grammar, `document.URL.split` and the `currentSlide` regex | `REPORT-1.md:343` (Live player grammar) |
| push direction decode | `REPORT-1.md:367` (Push direction decode); `sslop/D-004/push/push-directions.json` |
| `.key` parse result | `REPORT-1.md:382` (`.key` parse result); `convert/key.js:307`; `sslop/D-004/key/summary.json` |
| font availability table | `REPORT-1.md:403` (Font availability table) |
| media size projection and the Q-005 verdict | `REPORT-1.md:425` (Media size projection); `sslop/D-004/media/results.v2.tsv` |
| spike slides named | `REPORT-1.md:469` (Spike slides) |
| tolerance set | `REPORT-1.md:481` (Tolerance) |
| `schema/deck.schema.json` draft | `schema/deck.schema.json:1`; `convert/validate.js:26`; `convert/test/schema.test.js` |
| `package.json` with the design's scripts | `package.json:8`; `convert/test/package.test.js` |
| `convert/kpf.js` with a cache | `convert/kpf.js:48`; `convert/test/kpf.test.js` |
| `convert/pdf.js` discovery with the SVG fixture | `convert/pdf.js:50`; `convert/test/fixtures/slide1-p1.svg`; `convert/test/pdf.test.js` |
| `convert/key.js` | `convert/key.js:96`; `convert/test/key.test.js` |
| `.gitignore` | `.gitignore:1` |

## Corrections after review

Appended by checkpoint 2 after the G3 reviews of checkpoint 1 (D-008, D-009). The tables above are not edited. Where a number below differs from a table above, the number below is the corrected one.

Texture formats, corrected (D-008 F-01): `mutool` writes `<use xlink:href="#image_N">` for a re-placed raster on 21 of 937 pages. The checkpoint 1 classifier counted every `<use>` as a glyph placement, so 21 picture pages were classed as text. With the rule "a glyph placement is a `<use>` whose href starts with `font_`", the counts are:

| field | checkpoint 1 | corrected |
|---|---|---|
| text pages | 415 | 414 |
| picture pages | 167 | 168 |
| text pages that also carry an `<image>` | 41 | 40 |
| glyph placements, text pages | 7,505 | 7,470 |
| `<image>` on text pages | 99 | 96 |

The fixture `convert/test/fixtures/slide12-p6.svg` (slide 12 `AFB598FC`, texture `C4BF6FDE`, page index 6, 1373x343) holds one image use and zero words; `convert/test/pdf.test.js` asserts it.

Composite pages, corrected rule (D-009 F1): the `textureType` decode above says a `textureType` 0 page is "not an element; the player composites itself". That rule discards slide 1, whose 88 glyph placements live in its only `textureType` 0 page. The rule now: a composite page is a snapshot only when its event has at least one other content leaf (`text`, `picture`, `mixed`, `shape`). The composite can be the event's only content leaf (slides 1, 23, 31, 43, 44, 53, 54, 61, 62, 63). Then it converts like any page and `Slide.kpf.compositeAsContent` is true. `convert/plan.js` holds the rule and `convert/test/plan.test.js` tests both branches on slides 1 and 4.

Mixed pages, corrected rule (D-009 F2): the line "these keep the outlines and lose the raster in checkpoint 2" is withdrawn. A page with glyph placements and an `<image>` (40 pages; slide 51 page 4 has 215 glyphs and a two-image diagram) is class `mixed`. It becomes a text element from its glyph placements AND one image element per `<image>`, each placed by its SVG transform. Neither part is discarded.

Page classes, final (TECHNICAL.DESIGN.md revision 5): `text`, `picture`, `mixed`, `shape`, `background`, `poster`, `composite`. `convert/pdf.js` `classifyPage` is the one classifier.

## Checkpoint 2

The spike: `convert/index.js` writes `decks/_all_docs/deck.json` and `media/` for slides 1, 2, and 4, and `player/` plays them. The captures are `e2e/captures/spike-*.{live,new,diff}.png` with a `.json` sidecar each, taken by `pnpm e2e --grep spike` on this Mac with chromium-1248 through Playwright 1.64.1 at 960x540. Every number below comes from that run (two runs gave the same ratios) or from `.cache/convert-summary.json`.

### Captures and tolerance

| capture | state | mismatch ratio | pixels | tolerance | verdict |
|---|---|---|---|---|---|
| `spike-4` | slide 4 after its one manual step (the dim overlay dissolves, the two text boxes move in) | 0.00060 | 313 of 518,400 | 0.03 | pass |
| `spike-2` | slide 2 after settle, video boxes masked on both sides | 0.00000, vacuous | 0 unmasked of 518,400 | 0.03 | pass (vacuous, see below) |
| `spike-1-2` | 200 ms into the push from slide 1 to slide 2 | 0.00073 | 379 of 518,400 | 0.03 | pass |

`pixelmatch` 8.0.0, threshold 0.1. The default stays 0.03; no per-capture override exists in `e2e/tolerance.json`. The three measured ratios are below 0.001, so checkpoint 3 may tighten the default; this checkpoint does not.

The `spike-2` mask is vacuous. The GIF layer `D97C61E0` is 2118.31x1110.94 at slide (-99, -26), so its box covers the whole frame. The unmasked comparison has no pixels. The design's "450x236, 5.1 percent of the frame" describes the GIF file, not its layer. Two numbers stand in. First, the video region live versus new is 0.061 and 0.050 on the two runs, against `videoRegion` 0.6, recorded and never asserted. The live `<img>` GIF and the new `<video>` run at different phases. Second, the final state of slide 2 compared unmasked, live versus new, is 0.00057 (`spike-2.json`, `finalStateUnmaskedRatio`, recorded, not asserted). The warning text dissolved in at 3.51 s.

The `spike-1-2` capture takes the live side 200 ms after ArrowRight as the design states. Its actual progress is read from the frame. Slide 1's black top band ends at column 603 of 960, so the content had moved 714 slide pixels. That is eased progress 0.372, raw 0.433 on the push curve. It is about 217 ms of the 500 ms transition once the key and screenshot latency of the live player are counted. The new player is frozen at that raw progress (`window.kinetic.freezeTransition`) and its boundary lands at column 603 too. A first attempt that captured the new side at the same wall-clock 200 ms measured 0.732. The two players differ in input and screenshot latency by about 160 ms, and a push frame moves 3.8 slide pixels per millisecond. The comparison at equal progress is the one that tests rendering. The same capture found a real defect. Without clipping each slide to the stage, the full-bleed GIF layer of slide 2 spilled 50 capture pixels over the outgoing slide. `player/draw.js` clips now.

### Word split

| slide | text elements | words recovered | words in the composite snapshot | missing | errors |
|---|---|---|---|---|---|
| 1 | 1 (`DD0E5007`, composite as content) | 15: `OCTOBER 16TH, 2025 JSCONF NA CHARLIE ROBBINS Cloud Native Registry _all_docs towards a at edge` | no composite snapshot holds slide 1's glyphs (`4A5B9259` is slide 2's incoming snapshot, one image) | n/a | 0 by inspection of the capture |
| 2 | 1 (`1A0E3C95`) | 20: `WARNING: THIS TALK CONTAINS MOVING & FLASHING IMAGES. IF YOU ARE SENSITIVE TO THESE IN ANY WAY PLEASE BE ADVISED.` | 28 in `8D717B78` and `20D4F8C6` | 0 | 0 |
| 4 | 2 (`DCEA9E7D`, `EAA9333C`) | 5: `wisdom The`, `mikeal rogers of` | 5 in `55E6C056` | 0 | 0 |

Every word drawn from a text page on slides 2 and 4 also appears in the slide's composite. Slide 1 has no composite of itself; its only page is the content (D-009 F1).

### Push direction

Slide 1's transition is `apple:push` direction 12. In the live capture at 200 ms the content had moved left by 714 slide pixels. Slide 1 exits through the left edge, and slide 2 enters from the right. The mapping 12 = left holds. The new player, given `{ kind: "push", direction: "left" }`, draws the same frame within 379 pixels.

### Move-in direction code space

`convert/effects.js` checks every `apple:move in` against its own `position` keyframes. Slide 4 carries 12 move-ins with codes 11, 12, 13, 14. All 12 agree with the push mapping (11 right, 12 left, 13 down, 14 up, as the direction the content moves). Code 12 starts at +466 x (content moves left), and 13 at -272 y (moves down). Code 14 starts at +272 y (moves up), and 11 at -472 x (moves right). The code space is the same as the push's. The travel distance is recorded per build (`Build.distance`). A picture travels about its own size (270 for a 223x270 picture). A text box travels until its ink clears the edge (639 and 809 for the two 2071x49x text pages).

Nested effects start when their parent ends. Slide 4's first event chains ten move-ins over four levels of 0.25 s, so the collage arrives over one second. This was measured on the live player (`sslop/D-010/probe/live/timing2`). `Build.begin` records it: 0, 0, 0.25 x3, 0.5 x3, 0.75 x2.

Slide 4 is not word by word. Every `apple:move in` on it moves a whole picture or a whole text box; the per-word textures the design describes are not on this slide. `Build.unit` is `object` for all 13 builds; the converter sets `word` only when every target is a text element with exactly one word. The player plays `word` and `character` units with a stagger for checkpoint 3.

### Media (Q-005)

| source | pages | bytes |
|---|---|---|
| embedded image streams (`mutool extract -a`), slide 4, 10 single-image picture pages | 10 | 1,445,315 (9 JPEG kept as JPEG, 1 PNG) |
| the same 10 pages as 1x raster (`pdftocairo -png -r 72 -transp`), measured for the comparison | 10 | 2,341,537 |
| 1x raster, slide 4 page 10 (`C9856CF9`, two images) | 1 | 651,208 |
| video `c9cced4b0ea5` (`thinking-wilder`, 7,832,519 bytes of GIF): MP4 168,098, WebM 137,722, poster 142,993 | 1 | 448,813 |
| shape pages as vector `shape` elements (slide 4 overlay `073A0716`, slide 2 rectangle `5DFCB3F7`) | 2 | 0 |
| total `media/` | | 2,545,336 (2.6 MB on disk) |

Choice: image streams. They are 62 percent of the 1x raster bytes for the same pages. They are Keynote's own bytes with no resampling. `mutool extract -a` folds the SMask into PNG alpha. The two-image page falls back to the raster as the design says. `pdftocairo` runs with `-transp`; without it the 70 percent black overlay page rasterizes as solid gray on white. A picture page can hold an image larger than the page (a Keynote mask: slide 4 `F2BC9C96` is a 652x435 image behind a 223x270 window). Such a page keeps the whole stream and records `Element.crop`, the source rectangle the box shows. 6 of the 10 streams are cropped. `mutool extract` wrote 0 font files on these pages (`fontFilesDeleted` 0); the deletion path is unit tested with a stub.

### `source.path`

| slide | `key` | `pdf` | `texture` | elements |
|---|---|---|---|---|
| 1 | 0 | 1 | 0 | 1 text |
| 2 | 0 | 2 | 1 | 1 text, 1 shape, 1 video |
| 4 | 0 | 3 | 11 | 2 text, 1 shape, 11 image |
| total | 0 | 6 | 12 | 18 |

`key` is 0. `convert/key.js` harvests strings with no run-to-font association. So the design's condition for `key` (the run's font is on disk) cannot be evaluated. `deck.json` records `source.keyParse.fontCondition: "not evaluable"`. It also records `textMatched: 4 of 4` text elements whose every word is a whole token in a harvested run. The spike fonts are all absent on disk. They are Avenir, Futura, Menlo, Helvetica on slide 1; Helvetica Neue on slide 2; Avenir and Futura on slide 4. So the count would be 0 under the design's rule as well. The `.key` parse ran in 548 ms inside a worker with a 600 s guard.

### Benchmark

| side | measure | ms |
|---|---|---|
| live | `?currentSlide=2` navigation to the GIF `<img>` decoded (`complete` and `naturalWidth > 0`) | 2,737 |
| live | navigation to `#waitingIndicator` hidden | 2,737 |
| new | `goto(2)` to the first drawn frame, slide 2 preloaded, jump from slide 4 (no transition) | 14.4 |
| new | `goto(2)` to the first drawn frame of the push from slide 1 | 9.6 |
| new | `goto(2)` to the push landing on slide 2 | 510 |
| new | largest frame delta during the run | 16.7 |

Source: `e2e/captures/spike-bench.json`, written by `e2e/bench.spec.js`. The live number is one sample on this network; the new number is the preloaded case the design asks for.

### Format additions in this checkpoint

`schema/deck.schema.json` gains these fields. The first is `fill` on a word or glyph when it differs from the element. Slide 1 mixes yellow, magenta, white, and dark glyphs on one page. The second is `paths` on a text element for the body paths of its page. These are the bars and rules of slide 1, the underlines of slide 4, and the dark bands of slide 2. The rest are the `shape` element; `Build.begin`, `Build.distance`, `Build.automatic`; `Element.crop`; and `Slide.kpf` with `snapshots`, `stills`, and `compositeAsContent`. The video element replaces the still picture Keynote draws under the GIF (slide 2 `4D000C59`, listed under `Slide.kpf.stills`). `convertedAt` is the committer date of HEAD, so two runs at one HEAD are byte-identical (verified on all 15 output files).

### Checkpoint 2 Done

| item | where |
|---|---|
| `convert/layout.js` with the slide 2 test case and a synthetic nested case | `convert/layout.js:1`; `convert/test/layout.test.js` |
| `convert/pdf.js` `pageToElements`, glyph href rule, page classes | `convert/pdf.js`; `convert/test/pdf.test.js`; fixture `convert/test/fixtures/slide12-p6.svg` |
| `convert/plan.js` composite-as-content | `convert/plan.js`; `convert/test/plan.test.js` |
| `convert/media.js` streams, rasters, GIF transcode, font cleanup | `convert/media.js`; `convert/test/media.test.js` |
| `convert/effects.js` builds, timing, direction check | `convert/effects.js`; `convert/test/effects.test.js` |
| `convert/index.js` CLI, idempotent `deck.json`, validation last | `convert/index.js`; `decks/_all_docs/deck.json` (3 slides); `decks/_all_docs/media/` |
| `player/` | `player/index.html`, `player.js`, `preload.js`, `draw.js`, `effects.js`, `transitions.js` |
| `e2e/` suite, server, tolerance, captures | `playwright.config.js`; `e2e/serve.js`, `live.js`, `compare.js`, `tolerance.json`, `capture.spec.js`, `fonts.spec.js`, `bench.spec.js`; `e2e/captures/spike-*` |
| three captures under tolerance | this section, Captures and tolerance |
| word split error count, push direction, Q-005, `source.path`, benchmark, direction code space | this section |
| corrections after the CP1 reviews | Corrections after review |

## Checkpoint 3

All census effects map to the build vocabulary. All 71 slides convert to `decks/_all_docs/deck.json` and `media/`. The player plays every slide. The Playwright suite captures all 71 slides against the live export, proves the preload under network throttling, and finds no font request. The numbers below come from `pnpm convert` (summary in `.cache/convert-summary.json`) and `pnpm test`. They also come from the final full `pnpm e2e` run at `53e8e4d` on 2026-10-21 after the review fixes. Some come from `du` and `stat` over the committed tree. That run had 78 passed in 49.5 minutes; slide 64 timed out in a live screenshot and passed on its re-run. The capture platform is this Mac, chromium-1248 through Playwright 1.64.1, at 960x540, with `pixelmatch` 8.0.0 at threshold 0.1.

### Effect mapping

`convert/effects.js` maps every KPF name that the census found. It counts every visited `buildIn` effect by name before deduplication, so the mapped counts equal the recursive census of checkpoint 1. Zero names fell back to `appear`. The converter summary has an empty `unknownEffects` on all 71 slides.

| KPF name | kinetic effect | unit | mapped (recursive) | builds in `deck.json` | note |
|---|---|---|---|---|---|
| `apple:move in` | `move-in` | `object`, or `word` when every target is a one-word text element | 153 | 152 | one effect has the same targets as a sibling in its step and folds into it |
| `apple:move in character` | `move-in` | `character` | 14 | 14 | |
| `apple:dissolve` | `dissolve` | `object` | 25 | 25 | |
| `apple:dissolve character` | `dissolve` | `character` | 4 | 4 | |
| `apple:wipe` | `wipe` | `object` | 10 | 10 | code 11 (6) is `right` and code 12 (2) is `left`; code 21 (2) has no decoded direction and plays the KPF opacity ramp |
| `apple:keyboard` | `keyboard` | `character` | 8 | 8 | one reveal offset per character (`Build.offsets`, 291 in total) |
| `apple:appear` | `appear` | `object` | 1 | 1 | |
| `apple:bc-appear` | `appear` | `object` | 1 | 1 | |
| `apple:fade and move` | `fade-and-move` | `object` | 2 | 2 | |
| `com.apple.iWork.Keynote.LineDraw` | `line-draw` | `object` | 3 | 3 | durations 2 s, 2 s, 1 s |
| `renderMovie` | `movie-start` | `object` | 90 | 0 | folds into its parent `apple:movie-start` |
| `apple:movie-start` | `movie-start` | `object` | 90 | 90 | |
| `apple:push` | `push` | slide | 70 | 70 | `left` 55, `up` 7, `down` 5, `right` 3 |
| `none` | `none` | slide | 1 | 1 | slide 8 |
| unknown | `appear` | | 0 | 0 | zero fallbacks |

Totals: 310 builds in 84 steps (30 manual, 54 automatic). By unit: 259 `object`, 25 `word`, 26 `character`. The converter checked the direction code of every `apple:move in`, `apple:move in character`, and `apple:fade and move` against its position keyframes: 168 agree and 0 disagree. A per-word or per-character `move-in` has one `position` keyframe for the whole text, so all 39 of them have `Build.stagger` 0. Slides 15, 49, and 70 play six videos at once.

### Converter, all 71 slides

| count | value |
|---|---|
| elements | 834: 485 text, 145 image, 90 video, 114 shape |
| `source.path`, all 71 slides | `key` 0, `pdf` 599, `texture` 235 |
| text-texture fallbacks (a text page that became a raster) | 0 |
| mixed pages | 41 on 14 slides (slide:pages 12:2, 27:6, 29:1, 33:4, 39:3, 41:4, 44:1, 46:2, 51:1, 57:7, 58:4, 60:1, 64:1, 65:4) |
| `mixedFallbacks` | 0 |
| mixed pages whose body paths split around an image (a shape element under the image) | 4 (slides 29, 44, 58, 60) |
| text elements with body paths painted after the last glyph (a `-fg` shape over the text) | 35 |
| clip paths that govern a placement | 816: 805 rectangles, 11 other |
| placements outside their clip, dropped | 157 glyphs (slides 44 and 62), 2 images (slide 44), 0 paths |
| outlines a clip may cut, carrying `clip` | 7 glyphs, 146 paths |
| images a clip cuts, left to the leaf crop | 66, each 1 to 2 page pixels at the page edge |
| dashed stroke paths (`dash`) | 38 on slides 28, 31, 43, 44, 61, 62, 63 |
| mixed pages with an image between glyph rows | 11 |
| picture pages | 73: 70 take their embedded image stream, 3 take a 1x raster |
| images upside down in their page (`flip: "vertical"`) | 57 |
| composite-as-content slides | 10: 1, 23, 31, 43, 44, 53, 54, 61, 62, 63 |
| hidden elements | 587 of 834 |
| orphans (hidden, no build step) | 0 |
| `.key` parse | 5,116 strings; 217 of 485 text elements have every word as a whole token in a harvested run; the font condition is not evaluable, so `key` stays 0 (see Checkpoint 2) |
| font files that `mutool extract` wrote | 0 |
| `deck.json` | 12,390,998 bytes; 2,011 words; 10,344 glyph outlines |

Every `texture` element is an image or a video. No text page fell back to a raster.

Convert wall time: 39.6 s (`time pnpm convert --key .../2025/_all_docs.final.key`, real) from a warm cache. The cache holds the slide JSON, the PDFs, the GIFs, and the SVG pages, and the 73 transcodes are reused from `media/shared`. The run changed only `source.convertedAt` and `source.converter` in `deck.json`, which are the committer date and short sha of HEAD by design. No media file changed. The committed `deck.json` keeps the values of its own convert (`4e4e1c1`, the convert for the dash fix).

### Captures, all 71

Each slide is captured at its final build state on both sides. Rule `masked` masks the video boxes on both sides and compares the rest. Where the video boxes cover the frame, or overlap a text box, rule `animated-pixels-masked` applies. It compares the final state with the pixels that move on either side masked out. The test fills the glyph pixels of `deck.json` on a canvas, not through the player, and dilates them by 2 pixels. On those pixels only the motion of the live side counts. So a player that fails to draw a glyph over a video is seen. The spec asserts that every text box has at least one compared pixel. Each side takes one frame every 400 ms over the longest video loop of the slide, 3 to 32 frames. The mask is dilated by 2 pixels. Before this checkpoint the rule took three frames. On slide 64 that missed the pixels that the Earth GIF moves later in its 5.72 s loop. One run measured 0.03382 from the GIF phase alone. With the loop sampled, three runs of slide 64 measured 0.00287, 0.00288, and 0.00289.

| measure | value |
|---|---|
| slides | 71, all under the 0.03 default |
| min | 0 (slides 11, 53, 54) |
| median | 0.00149 |
| max | 0.01912 (slide 52) |
| slides above 0.01 | 27 (0.01140), 44 (0.01425), 52 (0.01912), 61 (0.01010), 65 (0.01044) |
| rule `masked` | 27 slides: 1, 4, 5, 11, 12, 19, 23, 24, 28, 31, 39, 42, 43, 44, 50, 51, 52, 53, 54, 58, 61, 62, 63, 66, 68, 69, 71 |
| rule `animated-pixels-masked` | 44 slides: 2, 3, 6, 7, 8, 9, 10, 13, 14, 15, 16, 17, 18, 20, 21, 22, 25, 26, 27, 29, 30, 32, 33, 34, 35, 36, 37, 38, 40, 41, 45, 46, 47, 48, 49, 55, 56, 57, 59, 60, 64, 65, 67, 70 |
| text boxes compared | every text box of every slide has compared pixels |
| default tolerance | 0.03, not raised |

Overrides in `e2e/tolerance.json`: none. The slide 60 override (0.045) is deleted. Its reason was false: the mismatch was a z-order defect (see Review fixes). Slide 60 now measures 0.00561.

Masked text. Ten slides move from `masked` to `animated-pixels-masked` because a video box overlaps a text box: 3, 7, 8, 15, 16, 47, 49, 56, 59, 70. Slides 3, 7, and 15 compared 2,022, 1,080, and 11,291 pixels before, all outside their text. They now compare 270,202, 433,164, and 130,531 pixels, and inside their text boxes 222,006, 433,164, and 37,186.

Per slide (`frames` is the frame count per side; `text boxes compared` counts the text boxes with at least one compared pixel):

| # | rule | ratio | compared pixels | masked fraction | text boxes compared | frames | tolerance |
|---|---|---|---|---|---|---|---|
| 1 | masked | 0.00002 | 518,400 | 0 | 1 of 1 | 3 | 0.03 |
| 2 | animated-pixels-masked | 0.00049 | 397,843 | 0.233 | 1 of 1 | 15 | 0.03 |
| 3 | animated-pixels-masked | 0.00028 | 270,202 | 0.479 | 2 of 2 | 17 | 0.03 |
| 4 | masked | 0.00060 | 518,400 | 0 | 2 of 2 | 3 | 0.03 |
| 5 | masked | 0.00005 | 165,240 | 0.681 | 7 of 7 | 3 | 0.03 |
| 6 | animated-pixels-masked | 0.00002 | 456,321 | 0.12 | 1 of 1 | 6 | 0.03 |
| 7 | animated-pixels-masked | 0.00421 | 433,164 | 0.164 | 9 of 9 | 3 | 0.03 |
| 8 | animated-pixels-masked | 0.00040 | 276,355 | 0.467 | 1 of 1 | 14 | 0.03 |
| 9 | animated-pixels-masked | 0.00124 | 480,356 | 0.073 | 3 of 3 | 6 | 0.03 |
| 10 | animated-pixels-masked | 0.00308 | 483,428 | 0.067 | 2 of 2 | 4 | 0.03 |
| 11 | masked | 0.00000 | 140,160 | 0.73 | 0 of 0 | 3 | 0.03 |
| 12 | masked | 0.00161 | 518,400 | 0 | 2 of 2 | 3 | 0.03 |
| 13 | animated-pixels-masked | 0.00842 | 436,612 | 0.158 | 0 of 0 | 15 | 0.03 |
| 14 | animated-pixels-masked | 0.00148 | 399,235 | 0.23 | 1 of 1 | 5 | 0.03 |
| 15 | animated-pixels-masked | 0.00442 | 130,531 | 0.748 | 1 of 1 | 31 | 0.03 |
| 16 | animated-pixels-masked | 0.00003 | 437,359 | 0.156 | 3 of 3 | 11 | 0.03 |
| 17 | animated-pixels-masked | 0.00048 | 397,719 | 0.233 | 3 of 3 | 5 | 0.03 |
| 18 | animated-pixels-masked | 0.00199 | 113,607 | 0.781 | 2 of 2 | 8 | 0.03 |
| 19 | masked | 0.00143 | 518,400 | 0 | 3 of 3 | 3 | 0.03 |
| 20 | animated-pixels-masked | 0.00028 | 451,732 | 0.129 | 2 of 2 | 21 | 0.03 |
| 21 | animated-pixels-masked | 0.00017 | 337,559 | 0.349 | 9 of 9 | 13 | 0.03 |
| 22 | animated-pixels-masked | 0.00404 | 504,543 | 0.027 | 197 of 197 | 8 | 0.03 |
| 23 | masked | 0.00605 | 518,400 | 0 | 1 of 1 | 3 | 0.03 |
| 24 | masked | 0.00546 | 518,400 | 0 | 55 of 55 | 3 | 0.03 |
| 25 | animated-pixels-masked | 0.00089 | 313,908 | 0.394 | 35 of 35 | 10 | 0.03 |
| 26 | animated-pixels-masked | 0.00054 | 307,710 | 0.406 | 1 of 1 | 31 | 0.03 |
| 27 | animated-pixels-masked | 0.01140 | 511,221 | 0.014 | 16 of 16 | 14 | 0.03 |
| 28 | masked | 0.00188 | 518,400 | 0 | 2 of 2 | 3 | 0.03 |
| 29 | animated-pixels-masked | 0.00068 | 361,113 | 0.303 | 1 of 1 | 5 | 0.03 |
| 30 | animated-pixels-masked | 0.00011 | 386,717 | 0.254 | 1 of 1 | 10 | 0.03 |
| 31 | masked | 0.00900 | 518,400 | 0 | 1 of 1 | 3 | 0.03 |
| 32 | animated-pixels-masked | 0.00016 | 451,077 | 0.13 | 3 of 3 | 5 | 0.03 |
| 33 | animated-pixels-masked | 0.00604 | 269,773 | 0.48 | 4 of 4 | 10 | 0.03 |
| 34 | animated-pixels-masked | 0.00414 | 518,400 | 0 | 2 of 2 | 8 | 0.03 |
| 35 | animated-pixels-masked | 0.00001 | 472,461 | 0.089 | 1 of 1 | 13 | 0.03 |
| 36 | animated-pixels-masked | 0.00573 | 360,938 | 0.304 | 1 of 1 | 11 | 0.03 |
| 37 | animated-pixels-masked | 0.00149 | 458,478 | 0.116 | 1 of 1 | 4 | 0.03 |
| 38 | animated-pixels-masked | 0.00598 | 326,017 | 0.371 | 3 of 3 | 6 | 0.03 |
| 39 | masked | 0.00283 | 518,400 | 0 | 10 of 10 | 3 | 0.03 |
| 40 | animated-pixels-masked | 0.00077 | 446,425 | 0.139 | 7 of 7 | 3 | 0.03 |
| 41 | animated-pixels-masked | 0.00388 | 281,819 | 0.456 | 4 of 4 | 7 | 0.03 |
| 42 | masked | 0.00005 | 129,600 | 0.75 | 7 of 7 | 3 | 0.03 |
| 43 | masked | 0.00751 | 518,400 | 0 | 1 of 1 | 3 | 0.03 |
| 44 | masked | 0.01425 | 518,400 | 0 | 1 of 1 | 3 | 0.03 |
| 45 | animated-pixels-masked | 0.00071 | 404,740 | 0.219 | 3 of 3 | 8 | 0.03 |
| 46 | animated-pixels-masked | 0.00038 | 510,812 | 0.015 | 10 of 10 | 16 | 0.03 |
| 47 | animated-pixels-masked | 0.00084 | 303,387 | 0.415 | 2 of 2 | 12 | 0.03 |
| 48 | animated-pixels-masked | 0.00035 | 177,764 | 0.657 | 1 of 1 | 5 | 0.03 |
| 49 | animated-pixels-masked | 0.00078 | 485,385 | 0.064 | 1 of 1 | 9 | 0.03 |
| 50 | masked | 0.00497 | 518,400 | 0 | 1 of 1 | 3 | 0.03 |
| 51 | masked | 0.00310 | 518,400 | 0 | 3 of 3 | 3 | 0.03 |
| 52 | masked | 0.01912 | 518,400 | 0 | 0 of 0 | 3 | 0.03 |
| 53 | masked | 0.00000 | 518,400 | 0 | 0 of 0 | 3 | 0.03 |
| 54 | masked | 0.00000 | 518,400 | 0 | 0 of 0 | 3 | 0.03 |
| 55 | animated-pixels-masked | 0.00009 | 403,433 | 0.222 | 3 of 3 | 4 | 0.03 |
| 56 | animated-pixels-masked | 0.00005 | 347,072 | 0.33 | 3 of 3 | 16 | 0.03 |
| 57 | animated-pixels-masked | 0.00453 | 517,050 | 0.003 | 7 of 7 | 16 | 0.03 |
| 58 | masked | 0.00186 | 518,400 | 0 | 5 of 5 | 3 | 0.03 |
| 59 | animated-pixels-masked | 0.00010 | 182,460 | 0.648 | 1 of 1 | 16 | 0.03 |
| 60 | animated-pixels-masked | 0.00561 | 518,400 | 0 | 2 of 2 | 15 | 0.03 |
| 61 | masked | 0.01010 | 518,400 | 0 | 1 of 1 | 3 | 0.03 |
| 62 | masked | 0.00843 | 518,400 | 0 | 1 of 1 | 3 | 0.03 |
| 63 | masked | 0.00962 | 518,400 | 0 | 1 of 1 | 3 | 0.03 |
| 64 | animated-pixels-masked | 0.00293 | 182,679 | 0.648 | 1 of 1 | 16 | 0.03 |
| 65 | animated-pixels-masked | 0.01044 | 228,028 | 0.56 | 11 of 11 | 6 | 0.03 |
| 66 | masked | 0.00628 | 518,400 | 0 | 2 of 2 | 3 | 0.03 |
| 67 | animated-pixels-masked | 0.00157 | 301,622 | 0.418 | 1 of 1 | 4 | 0.03 |
| 68 | masked | 0.00477 | 518,400 | 0 | 4 of 4 | 3 | 0.03 |
| 69 | masked | 0.00018 | 518,400 | 0 | 4 of 4 | 3 | 0.03 |
| 70 | animated-pixels-masked | 0.00675 | 517,012 | 0.003 | 3 of 3 | 10 | 0.03 |
| 71 | masked | 0.00145 | 132,030 | 0.745 | 2 of 2 | 3 | 0.03 |

### Word build (Q-007)

Slide 21, `apple:keyboard`, unit `character`, effect `keyboard`: eight one-character text elements (P U T U M E N T). Each is revealed at its own offset, 0.712 to 2.287 s after the build begins at 5.05 s. The final state measures 0.00020 (67 of 336,935 pixels, rule `animated-pixels-masked`), under 0.03. The new player frozen at 6.48 s shows 3 of 8 units (`11100000`). The live side takes a burst of frames over the build window. It showed 0, 1, 2, 3, 4, 6, 7, then 8 units, and the frame at 6,627 ms shows 3. A unit counts as shown when its box holds at least half of its final count of fill-coloured pixels. Only the target boxes are read. The test asserts some but not all units on each side, and it fails when every unit is revealed at once. Live against new inside the target boxes at the mid frame is 0.12124, recorded and not asserted. The video phase behind the letters is in it. Slide 71 moved its quote as one block (one texture, one `position` animation), so it was not a per-unit build.

### Preload under throttling

CDP `Network.emulateNetworkConditions` at 1.5 Mbit/s down, 750 kbit/s up, 150 ms latency, applied before the player loads. The first slide is drawn after 67,037 ms, because `deck.json` (12,390,998 bytes) loads under the throttle.

| measure | value |
|---|---|
| slowest preload | slide 67 (n+2 is 69), 23,443 ms, waived: 4,332,357 bytes, floor 23,856 ms |
| slowest preload within the 10 s bar | slide 28 (n+2 is 30), 9,780 ms, 1,783,570 bytes |
| largest frame delta, 30 frames after each of 70 changes | 49.9 ms (50 to 51), under the 50 ms bar; the host had a 1-minute load up to 14.7 from `mediaanalysisd` and Spotlight during this session |
| failures | 0 |

Waivers. The 10 s bar moves 1,875,000 bytes at this throttle. The transfer floor is the bytes at 1.5 Mbit/s plus one 150 ms latency per round of six requests. Where the media still pending at goto(n) needs more than 10 s by that floor, the spec asserts the floor plus 10 s instead. It records the waiver in `e2e/captures/preload.json`. This is a deviation from the design's bar. The supervisor decides at the gate.

| n | pending | bytes | requests | floor ms | bar ms | preload ms |
|---|---|---|---|---|---|---|
| 1 | 2, 3 | 2,063,675 | 12 | 11,306 | 21,306 | 11,420 |
| 2 | 4 | 2,096,523 | 11 | 11,481 | 21,481 | 11,448 |
| 10 | 12 | 2,533,464 | 6 | 13,662 | 23,662 | 13,755 |
| 13 | 15 | 2,491,341 | 12 | 13,587 | 23,587 | 13,896 |
| 44 | 46 | 1,995,752 | 12 | 10,944 | 20,944 | 10,911 |
| 47 | 49 | 2,173,165 | 12 | 11,890 | 21,890 | 11,858 |
| 48 | 50 | 2,479,669 | 6 | 13,375 | 23,375 | 13,462 |
| 62 | 64 | 1,991,188 | 11 | 10,920 | 20,920 | 10,899 |
| 67 | 69 | 4,332,357 | 25 | 23,856 | 33,856 | 23,443 |
| 68 | 70 | 2,945,976 | 13 | 16,162 | 26,162 | 15,994 |

The frame bar. The first full run of this checkpoint (D-017, 2026-10-21 01:30Z) failed five changes. They were 40 to 41 at 83.3 ms, 56 to 57 at 100 ms, and 62 to 63 at 83.2 ms. The others were 63 to 64 at 116.6 ms and 66 to 67 at 116.5 ms. The failure did not come back in five later runs with the same frame loop. They were the preload spec alone, the whole suite with the capture spec ahead of it, and the final full run. The other two were probes of slides 36 to 68 with 4 and 12 busy-loop processes on the 10 CPUs (1-minute load up to 37.8). Every change in them held 16.8 ms. No player code path was shown to cause it, so the frame code is unchanged. The cause is not verified. That run had no recorded load, and the host had a kernel panic about 37 minutes after it. The bar (50 ms over the 30 frames after a change) is not raised and not waived.

One preload defect was found and fixed while that was probed. `goto(n)` loads n+1, n+2, and then n-1, and then evicts outside that window. When n-1 was slow, an older call could evict after a later `goto` had loaded its own n+2, and that slide then stayed unready. Now only the newest call evicts. The test "a slow older preload never evicts the newer window" holds back the slide 37 media for 4 s. It asserts that slides 38 to 41 stay preloaded.

### Fonts

`e2e/fonts.spec.js` plays all 71 slides: 387 requests, 0 font requests. `find stage/1/kinetic -type f` for `.ttf`, `.otf`, `.woff`, `.woff2`, and `.cff` outside `node_modules` prints nothing.

### GIF transcode table

`ffmpeg` 9.0.1 transcodes each distinct GIF once, keyed by the sha256 of its bytes. MP4: `-movflags faststart -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -pix_fmt yuv420p -c:v libx264 -crf 23 -an`. WebM: the same scale, then `-pix_fmt yuv420p -c:v libvpx-vp9 -b:v 0 -crf 32 -an`. Poster: `-frames:v 1`. No GIF has alpha in its first frame, so every WebM is `yuv420p`. A name is the original basename without its `.gif-<start>-<end>.gif` suffix. The ratio is MP4 plus WebM plus poster bytes over the original GIF bytes. The table is regenerated from the committed `deck.json` and `media/`.

| sha256-12 | original name | slides | original bytes | MP4 bytes | WebM bytes | poster bytes | ratio |
|---|---|---|---|---|---|---|---|
| `c0de2c644e86` | seen-things | 11 | 12,619,759 | 318,028 | 229,045 | 157,226 | 5.6 percent |
| `16e9e587d147` | brooklyn99-papers | 3 | 10,090,326 | 434,994 | 347,224 | 237,526 | 10.1 percent |
| `7b841497aff9` | it-could-work | 57 | 9,432,988 | 191,198 | 192,958 | 76,557 | 4.9 percent |
| `c9cced4b0ea5` | thinking-wilder | 2 | 7,832,519 | 168,098 | 137,722 | 142,993 | 5.7 percent |
| `80d5734cad33` | Air Pollution Nyc GIF by Njorg | 15 | 7,778,774 | 806,490 | 747,506 | 129,081 | 21.6 percent |
| `aa383b9c8acb` | Earth Planet GIF by National Institute of Standards and Technology (NIST) | 46, 56, 59, 64 | 7,617,051 | 515,146 | 796,544 | 219,104 | 20.1 percent |
| `cddd415d2d3f` | confused | 45 | 5,276,820 | 101,378 | 113,665 | 187,541 | 7.6 percent |
| `bd6561d2e1e0` | thank-you-creek | 70 | 5,240,950 | 117,326 | 153,089 | 346,944 | 11.8 percent |
| `2d2d3df44ac2` | water splashing GIF | 26 | 4,983,623 | 468,160 | 567,165 | 76,122 | 22.3 percent |
| `899d4dc037eb` | made-myself-sad | 16 | 4,506,188 | 113,883 | 158,776 | 114,581 | 8.6 percent |
| `e31205c33cd5` | sneakers-david-strathairn | 35 | 4,345,128 | 202,696 | 99,733 | 144,330 | 10.3 percent |
| `a234efda99a8` | thank-you-so-much | 70 | 4,277,295 | 141,692 | 148,616 | 194,025 | 11.3 percent |
| `27e735f95842` | limbo-hermes | 46, 47, 59, 64 | 3,715,642 | 260,425 | 254,866 | 182,007 | 18.8 percent |
| `acf234523c05` | i-was-zero-cool-zero-cool | 34 | 3,381,521 | 93,955 | 74,301 | 135,505 | 9.0 percent |
| `cd6e9ca6a6be` | what year is it GIF | 18 | 3,170,227 | 112,263 | 99,955 | 176,651 | 12.3 percent |
| `ee6ae0c5f195` | motion geyser GIF | 26 | 3,144,404 | 145,773 | 148,480 | 183,122 | 15.2 percent |
| `0a7df24b56af` | skeptical-chicken | 6 | 2,992,279 | 101,455 | 76,743 | 161,101 | 11.3 percent |
| `575e8a5a38c4` | bell-building | 5 | 2,985,102 | 293,898 | 202,477 | 176,683 | 22.5 percent |
| `317acaacd074` | Work Spinning GIF by Beeld en Geluid | 3 | 2,769,344 | 238,647 | 293,569 | 116,180 | 23.4 percent |
| `f362cecef0ea` | delivery GIF (1) | 20 | 2,751,550 | 461,660 | 229,112 | 126,881 | 29.7 percent |
| `f52413383c81` | simpsons-electricity | 15 | 2,563,551 | 369,818 | 435,749 | 356,738 | 45.3 percent |
| `ef79f073bf6f` | Doc Brown Model GIF by Back to the Future Trilogy | 42 | 2,462,484 | 182,386 | 188,371 | 270,581 | 26.0 percent |
| `56cf528d6731` | Delivery GIF | 21 | 2,421,404 | 157,561 | 128,281 | 200,283 | 20.1 percent |
| `18c689610dc0` | Files Workload GIF | 3 | 2,371,804 | 203,094 | 142,859 | 292,495 | 26.9 percent |
| `8d03a6159faf` | Sand Emerge GIF by Warner Bros. Pictures | 33 | 2,363,690 | 107,972 | 118,183 | 176,228 | 17.0 percent |
| `cddf1a8e58f1` | life below zero GIF by National Geographic Channel | 65 | 2,333,365 | 176,714 | 169,917 | 158,844 | 21.7 percent |
| `245c979dae54` | Skeleton Dance Halloween GIF by Squirrel Monkey | 30 | 2,304,699 | 366,146 | 335,790 | 153,435 | 37.1 percent |
| `0156df90fab6` | externals-box | 13, 60 | 2,220,559 | 402,437 | 427,626 | 205,513 | 46.6 percent |
| `684b628c36a9` | Fox Tv Help GIF by 9-1-1 on FOX | 36 | 2,167,592 | 240,286 | 176,521 | 219,715 | 29.4 percent |
| `b2bb87f3b176` | Black And White Halloween GIF by Fleischer Studios | 30 | 2,164,215 | 374,205 | 387,986 | 145,902 | 42.0 percent |
| `d932efd65cd9` | show-me-matrix | 41 | 2,133,170 | 88,002 | 77,172 | 121,609 | 13.4 percent |
| `951866a179fc` | water rodeo GIF | 26 | 2,128,622 | 578,876 | 386,441 | 66,237 | 48.5 percent |
| `db06727fc718` | thank-you-bruce-lee | 70 | 2,015,536 | 192,707 | 149,629 | 265,919 | 30.2 percent |
| `561eb9a00d7f` | Climate Change Earth GIF by INTO ACTION (6) | 49 | 1,952,897 | 328,083 | 252,224 | 343,484 | 47.3 percent |
| `a24fe2880fca` | Halloween Skeleton GIF by Squirrel Monkey | 30 | 1,894,298 | 134,157 | 123,605 | 139,778 | 21.0 percent |
| `d5f8f4c18a0f` | Confused Green Bay Packers GIF by Martellus Bennett's Text Back Pack | 25 | 1,784,165 | 132,828 | 152,856 | 190,363 | 26.7 percent |
| `f33a15f5e5e4` | Democratic Socialism GIF by NYC-DSA | 15 | 1,702,280 | 139,988 | 123,567 | 94,400 | 21.0 percent |
| `590e2ee1e9eb` | Old School Yes GIF | 67 | 1,353,246 | 104,376 | 146,562 | 159,227 | 30.3 percent |
| `913d50c82e55` | Doc Brown GIF by Back to the Future Trilogy | 48 | 1,326,249 | 115,090 | 108,247 | 309,797 | 40.2 percent |
| `f7481163a85f` | i-got-a-solution | 55 | 1,199,351 | 135,287 | 147,337 | 223,956 | 42.2 percent |
| `9da92e8cc405` | force-with-you | 71 | 1,184,055 | 46,697 | 41,500 | 104,391 | 16.3 percent |
| `53b5c5ed56c2` | 171023-CRUSHER-KEVINJBEATY-01 | 29 | 1,131,251 | 151,418 | 135,475 | 258,326 | 48.2 percent |
| `f6022fb1ac92` | Pollute Climate Crisis GIF by INTO ACTION (1) | 49 | 1,127,936 | 198,459 | 223,397 | 298,944 | 63.9 percent |
| `a2a24e8b88d2` | elmo-thanks | 70 | 1,095,168 | 76,505 | 58,468 | 224,798 | 32.9 percent |
| `8925b1be03b2` | back to the future lightning GIF | 15 | 1,077,494 | 282,672 | 210,919 | 32,714 | 48.8 percent |
| `157d90947e33` | back_off_scientist_ghostbusters | 9 | 983,866 | 70,243 | 65,428 | 88,652 | 22.8 percent |
| `013989b3cb24` | angry-computer-panda | 27 | 975,919 | 707,965 | 750,635 | 48,751 | 154.5 percent |
| `dbcf16ee2f06` | package-delivery | 8 | 921,034 | 205,287 | 243,457 | 142,745 | 64.2 percent |
| `b44e23973809` | Climate Change Earth GIF by INTO ACTION (5) | 49 | 848,832 | 184,654 | 178,658 | 199,449 | 66.3 percent |
| `29b1ee029ab1` | files filing cabinet GIF | 3 | 799,039 | 105,203 | 44,382 | 138,989 | 36.1 percent |
| `4eb1863bbdaa` | bored gravity falls GIF | 22 | 742,288 | 132,047 | 94,010 | 175,850 | 54.1 percent |
| `61d86126e214` | studying short circuit GIF | 38 | 739,806 | 117,628 | 108,078 | 98,286 | 43.8 percent |
| `8c67b43c2ca4` | books-pile | 3 | 640,031 | 164,101 | 105,842 | 63,894 | 52.2 percent |
| `7a8116205f0c` | thank-you | 70 | 553,299 | 107,308 | 48,187 | 112,850 | 48.5 percent |
| `32d461292530` | mel brooks comedy GIF | 17 | 524,706 | 70,340 | 36,162 | 188,208 | 56.2 percent |
| `8bd18aba3be6` | cat-book | 32 | 484,205 | 98,195 | 79,991 | 74,065 | 52.1 percent |
| `950b4a6900d4` | zoidberg | 7 | 477,885 | 39,680 | 56,019 | 120,300 | 45.2 percent |
| `855a2eb67bfd` | scorpio | 46, 47, 56, 59, 64 | 468,913 | 58,629 | 58,968 | 232,717 | 74.7 percent |
| `5926c9077f2e` | work publishing GIF | 37 | 453,943 | 71,465 | 68,918 | 110,132 | 55.2 percent |
| `26af68de687e` | Dance Skeleton GIF | 30 | 415,082 | 231,754 | 171,119 | 116,210 | 125.1 percent |
| `10aa0e0006c9` | Skeleton Dance GIF | 30 | 406,032 | 123,033 | 102,075 | 98,961 | 79.8 percent |
| `9e508a478a1a` | glitch | 14 | 399,273 | 279,878 | 242,865 | 100,583 | 156.1 percent |
| `6745ccec8b9f` | 100 Feet Water Spray GIF | 26 | 346,765 | 104,875 | 34,882 | 113,517 | 73.0 percent |
| `38f7a123e3f3` | bender | 10 | 258,462 | 45,202 | 43,386 | 87,184 | 68.0 percent |
| `a0f57ee6ae92` | Climate Change Earth GIF by INTO ACTION (10) | 49 | 250,993 | 75,383 | 57,506 | 166,048 | 119.1 percent |
| `1d881c8a58d6` | printing-press | 40 | 233,091 | 26,642 | 41,317 | 53,914 | 52.3 percent |
| `ede8c3bdae81` | Question Mark Mario GIF | 46, 47, 56, 59, 64 | 187,295 | 17,519 | 14,283 | 34,108 | 35.2 percent |
| `5a6564b2d5fc` | Funny Money GIF | 46, 47, 64 | 154,810 | 27,172 | 25,364 | 168,663 | 142.9 percent |
| `9959a16e838c` | climate change politics GIF by NRDC | 15 | 139,718 | 105,197 | 58,686 | 130,221 | 210.5 percent |
| `198407e5c4ec` | climate change politics GIF by NRDC (1) | 15 | 124,239 | 102,842 | 56,735 | 115,025 | 221.0 percent |
| `ce65a22ec131` | Burning Climate Change GIF by INTO ACTION | 49 | 94,475 | 48,543 | 52,981 | 231,464 | 352.5 percent |
| `571e51397636` | Climate Change Earth GIF by INTO ACTION | 49 | 81,636 | 37,915 | 40,437 | 128,573 | 253.5 percent |
| `622e296740bd` | thank-you-neon | 70 | 56,369 | 23,525 | 14,444 | 53,301 | 161.9 percent |
| total | 73 distinct GIFs | 90 placements on 48 slides | 168,152,577 | 13,955,154 | 12,815,043 | 11,690,497 | 22.9 percent |

This table is the evidence for presentations#6. 168,152,577 bytes of GIF become 13,955,154 bytes of MP4 (8.3 percent) and 12,815,043 bytes of WebM (7.6 percent). A viewer downloads one of the two. With the 11,690,497 bytes of PNG posters, the output is 38,460,694 bytes, 22.9 percent of the GIF bytes. Ten small GIFs grow, most of all `Burning Climate Change GIF by INTO ACTION` at 352.5 percent, and the poster is most of that growth.

### Budget

`du -sk decks/_all_docs/media`: 61,368 KB at the push. An earlier read gave 61,580 KB with the same files, because `du` counts disk blocks. The files sum to 57,700,551 bytes in 338 files (219 under `media/shared`), 28.9 percent of the 200 MB budget. The largest file is `media/AFB598FC-F6E6-4CF4-959F-A9E10EE00990/DF0DEDC0701C7436568A6F0A7A9F970B.png` at 2,191,640 bytes, 11 percent of the 20 MB file budget. `convert/test/budget.test.js` asserts both limits against the committed tree and that every file is referenced.

### Files the suite writes

A full `pnpm e2e` writes `e2e/captures/<n>.*` (gitignored) and rewrites these committed files: `spike-*` (the three spike capture sets, `spike-2-final.*`, and `spike-bench.json`), `ratios.json`, `preload.json`, and `word-build*`. This checkpoint commits them on purpose as the evidence of the final run (`3fc9d05`, then `e453930` after the review fixes). No other committed file changes.

### Review fixes

The CP3 reviews D-019 and D-020 found four majors and one minor. This list closes them. Each fix has a regression that fails without it.

| finding | cause | fix commit | regression |
|---|---|---|---|
| D-019 F-01 / D-020 CP3-F1, z-order | A mixed page drew all its body paths after its images. Slide 60 drew a 75 percent black image under its red label box (0.03673 under a false override). Slides 29 and 44 hid emoji under a page fill. | `3383baf`: the paths before an image become a shape element under it. The slide 60 override is deleted. | `convert/test/pdf.test.js` path, image, path order; `convert/test/index.test.js` element order of slides 29, 44, 60; slide 60 measures 0.00561 at 0.03 |
| D-019 F-02 / D-020 CP3-F2, masked text | Under rule `masked` the video boxes hid every glyph of slides 3, 7, and 15. A player that drew no glyph passed at 0.00000. | `60f0540`: a slide whose video box overlaps a text box takes `animated-pixels-masked`. On the glyph pixels only live motion counts. Every text box must have a compared pixel. | the no-glyph mutation fails on slides 3 (0.08022), 7 (0.08168), and 15 (0.13710) |
| D-019 F-03, clip paths | `convert/pdf.js` counted `<clipPath>` and never applied it. Slide 62 drew its clipped Result block. Slide 44 drew two clipped step boxes. | `4e4e1c1`: a placement outside its clip is dropped. An outline that a clip may cut carries `clip`. Paths painted after the last glyph draw over the text. | `convert/test/pdf.test.js` clipped placement; `convert/test/index.test.js` text of slides 44 and 62 |
| D-020 CP3-F3 (D-019 F-05), word build | Slide 71 moved its quote as one block, and the motion check counted the video and the subtitle. | `5786e59`: the capture moves to the `apple:keyboard` build of slide 21. It asserts a partial reveal inside the target boxes on both sides. | revealing every unit at once fails (`8 of 8 units`, expected under 8) |
| D-019 F-04, dash arrays (MINOR) | `stroke-dasharray` was dropped, so dashed boxes and edges drew solid. | `53e8e4d`: one optional field, `dash`, drawn with `setLineDash` | `convert/test/pdf.test.js` dash array; slide 43 drops from 0.01135 to 0.00751 |

### Checkpoint 3 Done

| item | where |
|---|---|
| every census effect mapped, counts, zero `appear` fallbacks | Checkpoint 3, Effect mapping; `convert/effects.js`; `convert/test/effects.test.js` |
| player plays every unit and effect | `player/effects.js`, `player/draw.js`, `player/player.js`; `convert/test/player.test.js` |
| all 71 slides converted; `source.path`, text-texture fallbacks, mixed pages, composite-as-content, orphans | Checkpoint 3, Converter; `decks/_all_docs/deck.json`; `.cache/convert-summary.json` |
| convert wall time and idempotence | Checkpoint 3, Converter |
| all 71 captured, 71-ratio summary, rule per slide, no override | Checkpoint 3, Captures; `e2e/capture.spec.js`; `e2e/captures/ratios.json`; `e2e/tolerance.json` |
| overlapping video masks counted once | `e2e/compare.js` `maskedPixels`; `convert/test/compare.test.js` (`8537585`) |
| moving-pixel mask over the video loop | `e2e/compare.js` `animatedFrameCount`; `convert/test/compare.test.js` (`210b266`) |
| word-build capture | Checkpoint 3, Word build; `e2e/captures/word-build*` |
| preload green under throttling, slowest preload, largest frame delta, waivers | Checkpoint 3, Preload; `e2e/preload.spec.js`; `e2e/captures/preload.json` |
| preload eviction race fixed | `player/player.js` `preloadAround`; `e2e/preload.spec.js` race test (`37526f0`) |
| zero font requests, zero font files | Checkpoint 3, Fonts; `e2e/fonts.spec.js` |
| per-GIF transcode table, `ffmpeg` 9.0.1, presentations#6 | Checkpoint 3, GIF transcode table |
| budget under 200 MB and 20 MB per file | Checkpoint 3, Budget; `convert/test/budget.test.js` |
| one full `pnpm e2e` green | 79 passed, 0 failed, 30.4 minutes at `37526f0`; after the review fixes at `53e8e4d`: 78 passed, and slide 64 timed out in a live screenshot and passed on its re-run |

## Checkpoint 4

Checkpoint 4 makes Done machine-checkable. `bash check.sh` runs every check in order. `README.md`, `PROMPT.md`, and `PUBLISH.md` are new. This section also lands the carry-overs from the checkpoint 2 reviews (D-013, D-015). No upload was performed.

### Byte-exact media

Two clean converts used to write WebM files that differed in 16 bytes, the Matroska track UID (D-015 F-02). `convert/media.js` now passes `-fflags +bitexact -flags +bitexact` to the MP4 and the WebM `ffmpeg` commands (`d65ddf5`). The poster command is unchanged.

The proof is two clean converts at `0a79fa0`, both with `--key`. Each run wrote a new directory with `--out`, so neither run could reuse a transcode. An earlier pair of runs at `9974817` gave the same result.

| check | result |
|---|---|
| files per run | 339: `deck.json` and 338 media files |
| `diff -r` of the two output trees | no output, exit 0 |
| sha256 of every file, run C list against run D list | identical; the list itself hashes to `f96bbc64` in both |
| run C media against the committed media | 338 of 338 files byte-identical |
| run C `deck.json` against the committed `deck.json` | equal except `source.converter` and `source.convertedAt` |
| convert wall time, run C | 2 min 53 s (`time`, real) |
| convert wall time, run D | 2 min 46 s (`time`, real) |
| decoded frames, old against new, all 146 videos (`ffmpeg -f framemd5`) | 146 files, 0 differ |

The flags changed bytes, so the re-encoded videos are committed. Nothing else changed.

| output | files | bytes before | bytes after | delta |
|---|---|---|---|---|
| MP4 | 73 | 13,955,154 | 13,952,526 | -2,628 (-36 per file) |
| WebM | 73 | 12,815,043 | 12,810,819 | -4,224 (-53 or -58 per file) |
| poster PNG | 73 | 11,690,497 | 11,690,497 | 0 |
| per-slide images | 119 | | | 0, byte-identical |
| `media/` total | 338 | 57,700,551 | 57,693,699 | -6,852 |

`deck.json` records no output bytes. The committed `deck.json` keeps the stamps of its own convert (`5786e59`). The GIF transcode table of checkpoint 3 keeps its numbers. The bytes above are the current ones.

### Capture determinism

`pnpm e2e` used to rewrite tracked files under `e2e/captures/` (D-015 F-06). Now a run writes every capture set, `ratios.json`, `preload.json`, and `spike-bench.json` under `e2e/captures/out/`, which is gitignored (`eba5c44`). The committed sets are references. Each slide entry of the run's `ratios.json` carries the committed ratio as `reference`. Only `KINETIC_UPDATE_CAPTURES=1` writes to `e2e/captures/`. A unit test asserts the directory choice. The suite still asserts every fresh ratio against `e2e/tolerance.json`.

A live screenshot now times out after 30 s. A timeout on the live side of a slide gets one retry on a fresh page, and the entry records `liveRetried`. The slide test timeout is 360 s, which leaves room for the retry. This guards against the hang of slide 64 in checkpoint 3. There, `page.screenshot` of the live page hung for 16.8 minutes. The green run below needed no retry.

Proof: step h of `check.sh` below. After the full `pnpm e2e`, `git status --porcelain -- .` printed nothing. `git status --porcelain` over the whole worktree also printed nothing.

### check.sh

`check.sh` runs from any directory and prints each step with its command and exit code (`25a4b27`). It exits 0 only when every step passes. `pnpm validate` now also asserts 71 slides and `source.path` on every element (`node convert/validate.js decks/_all_docs/deck.json --slides 71`).

| step | command | exit | output |
|---|---|---|---|
| a1 | `node --version` | 0 | v24.16.0 |
| a2 | `pnpm --version` | 0 | 10.34.0 |
| a3 | `mutool -v` | 0 | 1.28.2 |
| a4 | `ffmpeg -version \| head -1` | 0 | 9.0.1 |
| a5 | `pdftocairo -v` | 0 | 26.08.0 |
| b | `pnpm install --frozen-lockfile` | 0 | |
| c | `pnpm exec playwright install chromium` | 0 | |
| d | `pnpm validate` | 0 | 71 slides, 834 elements, each with `source.path` |
| e | `pnpm test` | 0 | 83 tests, 83 pass, 0 fail |
| f | the font grep | 0 | no output |
| g | `pnpm e2e` | 0 | 79 passed (33.3m) |
| h | `git status --porcelain -- .` | 0 | no output |

Wall time: 33 min 19 s (1,999 s). Exit code: 0. The run was at `0a79fa0` on this Mac, started 2026-10-21T13:03Z from the home directory. The 1-minute load was 5.91 at the start. The live export answered 200 before the run.

The suite numbers of this run: 71 slides under 0.03, median 0.00143, max 0.01912 on slide 52. No live side needed a retry. The preload spec had 0 failures and the same 10 waivers. The largest frame delta after a change was 16.8 ms. The fonts spec saw 387 requests and 0 font requests. The first slide drew 67,189 ms after navigation under the throttle.

### Benchmark, regenerated

The checkpoint 2 benchmark table above does not match the committed `e2e/captures/spike-bench.json` (D-015 F-03). The table came from one run and the file from a later one. This table is regenerated from the committed file, which `e453930` wrote. It is one run on this network.

| side | measure | ms |
|---|---|---|
| live | `?currentSlide=2` navigation to the GIF `<img>` decoded (`navigationToGifDecodedMs`) | 1,140 |
| live | navigation to `#waitingIndicator` hidden (`navigationToIndicatorHiddenMs`) | 1,140 |
| new | `goto(2)` to the first drawn frame, slide 2 preloaded (`gotoToFirstFrameMs`) | 5.2 |
| new | `goto(2)` to the first drawn frame of the push from slide 1 (`pushFirstFrameMs`) | 5.3 |
| new | `goto(2)` to the push landing on slide 2 (`pushLandedMs`) | 505 |
| new | largest frame delta during the run (`maxFrameDeltaMs`) | 16.8 |

The green `check.sh` run wrote its own copy under `e2e/captures/out/`: live 1,836 and 1,836, new 3.4, 8.4, 508, and 16.8. The live number varies with the network from run to run.

### Other carry-overs

- README CLI note (D-015 F-05). `README.md` says `pnpm convert --slides 1,2,4`. Under pnpm 10, `pnpm convert -- --slides 1,2,4` fails, because pnpm forwards the literal `--`.
- Prose pass (D-008 F-06, D-015 F-08). Every sentence over 25 words in this file is split. No number changed. The multisets of numbers, code spans, and table rows are equal before and after the pass.
- Files the suite writes. The Checkpoint 3 section of that name is superseded. A run now writes only under `e2e/captures/out/`.
- `deck.json` compression. `PUBLISH.md` names gzip or brotli as a hosting step. `deck.json` is 12,390,998 bytes, 3,179,506 with `gzip -9`, and 2,071,563 with `brotli -q 11`.

### Checkpoint 4 Done

| item | where |
|---|---|
| `check.sh`, every step with its command and exit code | `check.sh`; Checkpoint 4, check.sh |
| `pnpm validate` asserts 71 slides and `source.path` | `convert/validate.js` `doneChecks`; `convert/test/schema.test.js` |
| byte-exact MP4 and WebM, two-run proof, byte delta | `convert/media.js` `BITEXACT`; `convert/test/media.test.js`; Checkpoint 4, Byte-exact media |
| capture determinism, the `KINETIC_UPDATE_CAPTURES` flag | `e2e/compare.js` `capturesDir`; `convert/test/compare.test.js`; Checkpoint 4, Capture determinism |
| bounded live screenshot with one retry | `e2e/capture.spec.js` `liveSide` |
| `README.md` | `README.md` |
| `PROMPT.md`, provenance reconstructed | `PROMPT.md` |
| publish notes, no upload | `PUBLISH.md` |
| benchmark table from the committed file | Checkpoint 4, Benchmark |
| prose pass, no number changed | this file |
| `bash check.sh` exits 0 | Checkpoint 4, check.sh: exit 0 in 33 min 19 s |
