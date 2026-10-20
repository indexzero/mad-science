---
checkpoint: 2
date: "2026-10-20"
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

Source: `sslop/D-004/textures/scan.mjs`, which runs `pageToSvg` and `parseSvg` over every page of every slide PDF (937 texture pages, 71 PDFs, 49,861,810 bytes of PDF). Every texture is one page of its slide's PDF. The class rule: a video poster is the `isVideoLayer` texture; `textureType` 0 is a snapshot; `textureType` 1 is a background; a page with one or more `<use>` placements is text; a page with no placements and one or more `<image>` is a picture; a page with only body paths is a shape.

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

The design's counts (580 hidden of 1,172 leaves, 15 layers below opacity 1, 2,963 identity and 71 perspective `sublayerTransform`, 736 `shapePath` entries, 18 `infoShapePath` entries) are the `events[].baseLayer` population. `masksToBounds` is false everywhere. `edgeAntialiasingMask` has two values and no effect on flat content.

## `textureType` decode

Source: `sslop/D-004/texturetype/`. Every texture page of slides 1, 2, 4, 51, and 69, with the `textureType` of the leaf that references it and the `<use>` count from `parseSvg`. Plus three `textureType` 6 pages from slides 7 and 9, because the five slides carry none.

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

The `.key` is 268 MB because `Data/` holds the media (378 entries). The IWA index is 631 KB. The strings carry Keynote's text runs per paragraph, so a word-by-word build appears as one run (`OCTOBER 16TH, 2025`), not as words. Checkpoint 2 matches the SVG word sequence of a text element against the runs, and marks `source.path: key` with the font when the run contains the element's words in order and the font is on disk.

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

The design's table says 10 Geist Mono cuts and 8 Avenir cuts. `header.json` names 9 and 7, and the rows then sum to 43. The 43 names, by family: Geist Mono 9, Avenir and Avenir Next 7, Helvetica and Helvetica Neue 6, Tw Cen MT 4, Graphik 3, Produkt 2, DIN 2, and one each of OstrichSans-Bold, Blanch-CapsLight, GTWalsheimRegular, MuseoSans-100, GDBoing-Bold, Futura-Medium, Calibri, Menlo-Bold, ArialMT, GillSans. `GDSherpa-Bold.otf` and `GDSherpa-Regular.otf` are on disk and not named. No font file is copied anywhere (`find` in Raw verification of the result).

## Media size projection

Source: `sslop/D-004/media/results.v2.tsv`. The five largest distinct GIFs, transcoded in scratch with the design's commands on ffmpeg 9.0.1 (MP4: `-movflags faststart -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" -pix_fmt yuv420p -c:v libx264 -crf 23 -an`; WebM: `-vf ... -pix_fmt yuv420p -c:v libvpx-vp9 -b:v 0 -crf 32 -an`; poster: `-frames:v 1`).

| GIF | size | frames | alpha < 255 in frame 1 | in bytes | MP4 bytes | WebM bytes | poster PNG | MP4 % | WebM % |
|---|---|---|---|---|---|---|---|---|---|
| `seen-things` | 642x263 | 165 | 0 | 12,619,759 | 318,028 | 229,045 | 157,226 | 2.5 | 1.8 |
| `brooklyn99-papers` | 498x280 | 101 | 0 | 10,090,326 | 434,994 | 347,224 | 237,526 | 4.3 | 3.4 |
| `it-could-work` | 420x261 | 145 | 0 | 9,432,988 | 191,198 | 192,958 | 76,557 | 2.0 | 2.0 |
| `thinking-wilder` | 450x236 | 77 | 0 | 7,832,519 | 168,098 | 137,722 | 142,993 | 2.1 | 1.8 |
| `Air Pollution Nyc GIF by Njorg` | 500x500 | 144 | 0 | 7,778,774 | 806,490 | 747,506 | 129,081 | 10.4 | 9.6 |

`thinking-wilder` reproduces the design's numbers (168,098 and 137,722). No sampled GIF has alpha, so WebM stays `yuv420p`.

Projection for the 73 distinct GIFs (168,152,577 bytes in), by the pooled ratios of the sample (MP4 4.02 percent, WebM 3.46 percent, poster 0.96 bytes per pixel over 11,491,695 pixels):

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

The 41 text pages with an embedded image are drawn as outlines; if the spike shows the raster matters, each adds one more raster element from the same table. No single file exceeds 20 MB in any layout (the largest 2x raster is 9,368,093 bytes, the largest MP4 806,490).

Verdict for Q-005: the design's 2x raster does not fit. 278.7 MB of PNG for 167 pictures is 139 percent of the budget before any video. The video side is small: 23.6 MB projected, 44.6 MB worst case, so presentations#6 can close once checkpoint 3 writes the per-GIF table (168.2 MB of GIF becomes about 12.6 MB of MP4 plus WebM). Committed `media/` holds with one change to the Media section: rasterize pictures at 1x (`-r 72`, `Element.scale` 1, 126.7 MB total) or, better, extract the embedded image streams with `mutool extract` and keep Keynote's own bytes (64.3 MB total, no resampling, needs the stream to page mapping that `mutool` prints). Checkpoint 2 picks one on the spike and REPORT-1.md records it. If the design keeps `-r 144`, the fallback applies: `media/` gitignored plus a `pnpm fetch-media` step in `check.sh`.

## Spike slides

The design's defaults, each checked against the census and the SVG parse:

| spike | slide | evidence | status |
|---|---|---|---|
| word-by-word build | slide 4 `88910011-5393-44BA-A490-715036B75B22` | top-level builds: `apple:move in`, `apple:move in`, `apple:dissolve character`, `apple:move in`, `apple:move in`; 17 textures; pages 14 and 15 are text (`wisdom The`, `mikeal rogers of`) | confirmed |
| GIF background | slide 2 `59BDD422-82F7-4357-91FC-9651246E9546` | one `apple:movie-start` with nested `renderMovie` on `thinking-wilder.gif-0.0000-5.3900.gif` (450x236, 7,832,519 bytes, sha256 `c9cced4b0ea5`) | confirmed |
| push transition | slide 1 `C1F6FE7C-13D3-4213-B5B2-00EBC914A8EB` to slide 2 | slide 1 transition `apple:push` direction 12, duration 0.5 s; incoming from (2880, 540), outgoing to (-960, 540) | confirmed |

No replacement is needed. Slide 4's builds are `apple:move in` with directions 13 and 14 on the top level and a nested `apple:move in` x3 under the first, which is the per-word detail the player needs. Slide 2's GIF is the one the design measured. The 1 to 2 push is direction 12, the most common direction.

## Tolerance

- Default: 3 percent mismatched pixels at 960x540 after the slide settles, `pixelmatch` 8.0.0 with `threshold` 0.1, as the design states. Checkpoint 1 keeps the default. The spike measures three ratios and may tighten it.
- Video boxes are masked on both captures. The slide 2 GIF box is 450x236 at 1920x1080, 5.1 percent of the frame, so the mask is required for the default to hold. The masked region is compared against the poster with its own recorded tolerance of 60 percent, not asserted.
- Expected discrepancy sources, in order: outline anti-aliasing (the live player rasterizes PDF, the new player fills `Path2D`), the word split on slides where `mutool` emits no space glyph (slide 1 splits correctly with the ink-edge gap rule; slide 4 pages 14 and 15 split correctly), and the GIF region.
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

Composite pages, corrected rule (D-009 F1): the `textureType` decode above says a `textureType` 0 page is "not an element; the player composites itself". That rule discards slide 1, whose 88 glyph placements live in its only `textureType` 0 page. The rule now: a composite page is a snapshot only when its event has at least one other content leaf (`text`, `picture`, `mixed`, `shape`). When the composite is the event's only content leaf (slides 1, 23, 31, 43, 44, 53, 54, 61, 62, 63) it converts like any page and `Slide.kpf.compositeAsContent` is true. `convert/plan.js` holds the rule and `convert/test/plan.test.js` tests both branches on slides 1 and 4.

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

The `spike-2` mask is vacuous: the GIF layer `D97C61E0` is 2118.31x1110.94 at slide (-99, -26), so its box covers the whole frame and the unmasked comparison has no pixels. The design's "450x236, 5.1 percent of the frame" describes the GIF file, not its layer. Two numbers stand in: the video region live versus new is 0.061 and 0.050 on the two runs (against `videoRegion` 0.6, recorded, never asserted; the live `<img>` GIF and the new `<video>` run at different phases), and the final state of slide 2 (the warning text dissolved in at 3.51 s) compared unmasked, live versus new, is 0.00057 (`spike-2.json`, `finalStateUnmaskedRatio`, recorded, not asserted).

The `spike-1-2` capture takes the live side 200 ms after ArrowRight as the design states. Its actual progress is read from the frame: slide 1's black top band ends at column 603 of 960, so the content had moved 714 slide pixels, eased progress 0.372, raw 0.433 on the push curve, about 217 ms of the 500 ms transition once the key and screenshot latency of the live player are counted. The new player is frozen at that raw progress (`window.kinetic.freezeTransition`) and its boundary lands at column 603 too. A first attempt that captured the new side at the same wall-clock 200 ms measured 0.732, because the two players differ in input and screenshot latency by about 160 ms and a push frame moves 3.8 slide pixels per millisecond; the comparison at equal progress is the one that tests rendering. The same capture found a real defect: without clipping each slide to the stage, the full-bleed GIF layer of slide 2 spilled 50 capture pixels over the outgoing slide (`player/draw.js` clips now).

### Word split

| slide | text elements | words recovered | words in the composite snapshot | missing | errors |
|---|---|---|---|---|---|
| 1 | 1 (`DD0E5007`, composite as content) | 15: `OCTOBER 16TH, 2025 JSCONF NA CHARLIE ROBBINS Cloud Native Registry _all_docs towards a at edge` | no composite snapshot holds slide 1's glyphs (`4A5B9259` is slide 2's incoming snapshot, one image) | n/a | 0 by inspection of the capture |
| 2 | 1 (`1A0E3C95`) | 20: `WARNING: THIS TALK CONTAINS MOVING & FLASHING IMAGES. IF YOU ARE SENSITIVE TO THESE IN ANY WAY PLEASE BE ADVISED.` | 28 in `8D717B78` and `20D4F8C6` | 0 | 0 |
| 4 | 2 (`DCEA9E7D`, `EAA9333C`) | 5: `wisdom The`, `mikeal rogers of` | 5 in `55E6C056` | 0 | 0 |

Every word drawn from a text page on slides 2 and 4 also appears in the slide's composite. Slide 1 has no composite of itself; its only page is the content (D-009 F1).

### Push direction

Slide 1's transition is `apple:push` direction 12. In the live capture at 200 ms the content had moved left by 714 slide pixels (slide 1 exits through the left edge, slide 2 enters from the right). The mapping 12 = left holds. The new player, given `{ kind: "push", direction: "left" }`, draws the same frame within 379 pixels.

### Move-in direction code space

`convert/effects.js` checks every `apple:move in` against its own `position` keyframes. Slide 4 carries 12 move-ins with codes 11, 12, 13, 14; all 12 agree with the push mapping (11 right, 12 left, 13 down, 14 up, as the direction the content moves): code 12 starts at +466 x (content moves left), 13 at -272 y (moves down), 14 at +272 y (moves up), 11 at -472 x (moves right). The code space is the same as the push's. The travel distance is recorded per build (`Build.distance`): a picture travels about its own size (270 for a 223x270 picture), a text box travels until its ink clears the edge (639 and 809 for the two 2071x49x text pages).

Nested effects start when their parent ends. Slide 4's first event chains ten move-ins over four levels of 0.25 s, so the collage arrives over one second (measured on the live player: `sslop/D-010/probe/live/timing2`). `Build.begin` records it: 0, 0, 0.25 x3, 0.5 x3, 0.75 x2.

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

Choice: image streams. They are 62 percent of the 1x raster bytes for the same pages, they are Keynote's own bytes with no resampling, and `mutool extract -a` folds the SMask into PNG alpha. The two-image page falls back to the raster as the design says. `pdftocairo` runs with `-transp`; without it the 70 percent black overlay page rasterizes as solid gray on white. A picture page whose image is larger than the page (a Keynote mask: slide 4 `F2BC9C96` is a 652x435 image behind a 223x270 window) keeps the whole stream and records `Element.crop`, the source rectangle the box shows; 6 of the 10 streams are cropped. `mutool extract` wrote 0 font files on these pages (`fontFilesDeleted` 0); the deletion path is unit tested with a stub.

### `source.path`

| slide | `key` | `pdf` | `texture` | elements |
|---|---|---|---|---|
| 1 | 0 | 1 | 0 | 1 text |
| 2 | 0 | 2 | 1 | 1 text, 1 shape, 1 video |
| 4 | 0 | 3 | 11 | 2 text, 1 shape, 11 image |
| total | 0 | 6 | 12 | 18 |

`key` is 0. `convert/key.js` harvests strings with no run-to-font association, so the design's condition for `key` (the run's font is on disk) cannot be evaluated; `deck.json` records `source.keyParse.fontCondition: "not evaluable"` and `textMatched: 4 of 4` text elements whose every word is a whole token in a harvested run. The spike fonts (Avenir, Futura, Menlo, Helvetica on slide 1; Helvetica Neue on slide 2; Avenir and Futura on slide 4) are all absent on disk, so the count would be 0 under the design's rule as well. The `.key` parse ran in 548 ms inside a worker with a 600 s guard.

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

`schema/deck.schema.json` gains: `fill` on a word or glyph when it differs from the element (slide 1 mixes yellow, magenta, white, and dark glyphs on one page); `paths` on a text element for the body paths of its page (the bars and rules of slide 1, the underlines of slide 4, the dark bands of slide 2); the `shape` element; `Build.begin`, `Build.distance`, `Build.automatic`; `Element.crop`; `Slide.kpf` with `snapshots`, `stills`, and `compositeAsContent`. The video element replaces the still picture Keynote draws under the GIF (slide 2 `4D000C59`, listed under `Slide.kpf.stills`). `convertedAt` is the committer date of HEAD, so two runs at one HEAD are byte-identical (verified on all 15 output files).

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
