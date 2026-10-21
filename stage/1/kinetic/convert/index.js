// Converter CLI. Reads a KPF export (URL or directory) plus the .key, writes decks/<id>/deck.json and media/.
//   node convert/index.js --kpf https://all-docs.talks.charlie.dev/ --key <path>.key --out decks/_all_docs --slides 1,2,4
// Idempotent: `source.convertedAt` is the committer date of HEAD and `source.converter` its short sha, so a
// second run at the same HEAD writes byte-identical output. Validation runs last and sets the exit code.
// A run summary for REPORT-1.md goes to .cache/convert-summary.json.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIVE_BASE, loadHeader, loadSlide, fetchAsset } from './kpf.js';
import { composeLeaves, roundBox } from './layout.js';
import { parsePage, pageToElements, classifyPage, wordsFromUses, withAdvances, stripOrder, mixedLayers, DEFAULT_FILL } from './pdf.js';
import { planLeaves } from './plan.js';
import { extractPageImages, placeImage, rasterize, transcodeGif } from './media.js';
import { collectBuilds, transitionOf } from './effects.js';
import { parseKeyGuarded } from './key.js';
import { validateDeck, formatError } from './validate.js';

const here = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(here, '..');
const CACHE = join(PROJECT, '.cache');
export const KEY_TIMEOUT_MS = 600000;

function parseArgs(argv) {
  const o = { kpf: LIVE_BASE, key: null, out: join(PROJECT, 'decks', '_all_docs'), slides: null, keyBudgetMs: 540000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--kpf') o.kpf = argv[++i];
    else if (a === '--key') o.key = argv[++i];
    else if (a === '--out') o.out = resolve(argv[++i]);
    else if (a === '--slides') o.slides = argv[++i].split(',').map((s) => Number(s.trim())).filter(Number.isFinite);
    else if (a === '--key-budget-ms') o.keyBudgetMs = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

function git(args, fallback) {
  try {
    return execFileSync('git', args, { cwd: PROJECT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

function walkLayers(root, fn) {
  if (!root) return;
  fn(root);
  for (const c of root.layers || []) walkLayers(c, fn);
}

function walkEffects(effects, fn) {
  for (const e of effects || []) {
    fn(e);
    walkEffects(e.effects, fn);
  }
}

/** The background color of a background page: the fill of its last body path (SVG default black). */
function backgroundOf(parsed) {
  const last = parsed.bodyPaths[parsed.bodyPaths.length - 1];
  const fill = last?.fill && last.fill !== 'none' ? last.fill : DEFAULT_FILL;
  return /^#[0-9a-fA-F]{6}$/.test(fill) ? fill.toLowerCase() : DEFAULT_FILL;
}

/**
 * The visible part of an image placement. `rect` is the image's full rectangle in slide space, `clip` the
 * leaf box (the page clips what it shows). Returns { box, crop } where `crop` is the source rectangle in
 * image pixels, or null when the whole image is visible.
 */
export function visibleImage(rect, clip, imgW, imgH) {
  const x = Math.max(rect.x, clip.x);
  const y = Math.max(rect.y, clip.y);
  const x2 = Math.min(rect.x + rect.w, clip.x + clip.w);
  const y2 = Math.min(rect.y + rect.h, clip.y + clip.h);
  const box = roundBox({ x, y, w: Math.max(0, x2 - x), h: Math.max(0, y2 - y) });
  const whole = Math.abs(box.x - rect.x) < 0.01 && Math.abs(box.y - rect.y) < 0.01 && Math.abs(box.w - rect.w) < 0.01 && Math.abs(box.h - rect.h) < 0.01;
  if (whole) return { box: roundBox(rect), crop: null };
  const sx = imgW / rect.w;
  const sy = imgH / rect.h;
  const r2 = (v) => Math.round(v * 100) / 100;
  return { box, crop: { x: r2((box.x - rect.x) * sx), y: r2((box.y - rect.y) * sy), w: r2(box.w * sx), h: r2(box.h * sy) } };
}

/** The image element fields of a placement: `flip` when the page draws the image upside down, with the crop mirrored to match. */
export function placementFields(pl, crop, imgH) {
  if (!pl.flipY) return crop ? { crop } : {};
  const out = { flip: 'vertical' };
  if (crop) out.crop = { ...crop, y: Math.round((imgH - crop.y - crop.h) * 100) / 100 };
  return out;
}

/**
 * Match each image placement of a mixed page to an extracted stream (D-023 R-1). A placement names its stream
 * by its pixels: `key` is the same `imageDataKey` on the SVG data URI and on the stream. A placement without a
 * keyed match falls back to the first stream of its pixel size (slide 44 places five streams of one size, so
 * size alone gave all seven emoji the first). A stream may match more than once. Returns { matched, sizeFallbacks }.
 */
export function matchStreams(placements, streams) {
  let sizeFallbacks = 0;
  const matched = placements.map((pl) => {
    const byKey = pl.key ? streams.find((s) => s.key === pl.key) : null;
    if (byKey) return byKey;
    const bySize = streams.find((s) => s.width === pl.width && s.height === pl.height) || null;
    if (bySize) sizeFallbacks += 1;
    return bySize;
  });
  return { matched, sizeFallbacks };
}

function kpfRef(uuid, texture, asset, tr) {
  return { slide: uuid, texture, page: asset.index, textureType: tr?.textureType ?? 0, isBackgroundTexture: tr?.isBackgroundTexture ?? false };
}

function newReport(index1, uuid) {
  return {
    index: index1,
    uuid,
    classes: {},
    elements: { text: 0, image: 0, video: 0, shape: 0 },
    sourcePath: { key: 0, pdf: 0, texture: 0 },
    bytes: { streams: 0, rasters: 0, video: 0 },
    pictures: { stream: 0, raster: 0 },
    mixedPages: 0,
    mixedFallbacks: 0,
    imageSizeFallbacks: 0,
    mixedInterleaved: 0,
    mixedPathSplits: 0,
    textPathsOver: 0,
    clips: { kinds: { rect: 0, other: 0 }, dropped: { glyph: 0, path: 0, image: 0 }, clipped: { glyph: 0, path: 0 }, partialImages: 0, conflicts: 0 },
    pictureShapes: { under: 0, over: 0, interleaved: 0 },
    flippedImages: 0,
    compositeAsContent: false,
    orphans: [],
    stills: [],
    textTextureFallbacks: 0,
    repeatedTextures: 0,
    skipped: [],
    composite: null,
    keyTextMatched: 0,
    fontFilesDeleted: 0,
    media: [],
  };
}

/** Convert one slide. Returns { slide, report }. */
async function convertSlide(ctx, index1, uuid, slide) {
  const { kpf, outDir, keyTokens, log } = ctx;
  const assets = slide.assets;
  const report = newReport(index1, uuid);
  const pdfName = Object.values(assets).find((a) => a.type === 'texture')?.url?.native;
  const pdf = pdfName ? (await fetchAsset(kpf, uuid, pdfName)).file : null;
  const svgDir = join(CACHE, 'svg', uuid);
  mkdirSync(svgDir, { recursive: true });
  const pageCache = new Map();
  const page = (textureId) => {
    const asset = assets[textureId];
    if (!asset || asset.type !== 'texture') return null;
    if (!pageCache.has(textureId)) pageCache.set(textureId, parsePage(pdf, asset.index, join(svgDir, `p${asset.index}.svg`)));
    return pageCache.get(textureId);
  };

  // video placements: an `apple:movie-start` effect targets the one leaf the video replaces (the still
  // Keynote draws under the GIF, visible in the first event); its nested `renderMovie` names the GIF asset
  // and holds the video layer, whose texture is the poster page. On 7 of the 90 placements the renderMovie
  // carries a second still that is not in the first event; it is listed under `kpf.stills` and never drawn.
  const videos = new Map(); // movie-start leaf texture -> { movieAsset, posterTexture, loopMode, still }
  const posterTextures = new Set();
  for (const ev of slide.events) {
    walkEffects(ev.effects, (e) => {
      if (e.name !== 'apple:movie-start') return;
      const own = [];
      walkLayers(e.baseLayer, (l) => { if (l.texturedRectangle && l.texture) own.push(l); });
      const rm = (e.effects || []).find((x) => x.movie?.asset && assets[x.movie.asset]);
      if (!rm || own.length !== 1) return;
      let videoLeaf = null;
      let still = null;
      walkLayers(rm.baseLayer, (l) => {
        if (l.isVideoLayer) videoLeaf = l;
        else if (l.texturedRectangle && l.texture && l.texture !== own[0].texture) still = l.texture;
      });
      if (videoLeaf?.texture) posterTextures.add(videoLeaf.texture);
      videos.set(own[0].texture, { movieAsset: rm.movie.asset, posterTexture: videoLeaf?.texture ?? null, loopMode: rm.movie.loopMode, still });
    });
  }

  // classify the first event's leaves and plan which are content
  const leaves = composeLeaves(slide.events[0].baseLayer).filter((l) => assets[l.texture]);
  for (const l of leaves) {
    const a = assets[l.texture];
    const tr = l.layer.texturedRectangle;
    l.cls = classifyPage(page(l.texture), { textureType: tr.textureType, isBackgroundTexture: tr.isBackgroundTexture, isPoster: posterTextures.has(l.texture), width: a.width, height: a.height });
    report.classes[l.cls] = (report.classes[l.cls] || 0) + 1;
  }
  const plan = planLeaves(leaves);
  report.compositeAsContent = plan.compositeAsContent;
  const background = { kind: 'color', value: plan.background ? backgroundOf(page(plan.background.texture)) : '#000000' };
  for (const l of plan.empty) report.skipped.push({ texture: l.texture, reason: `class ${l.cls}` });

  const elements = [];
  const idOfTexture = new Map(); // texture -> the id of its first element
  const elementsOfTexture = new Map(); // texture -> [{ id, leaf }], one per leaf that carries it
  const occurrences = new Map(); // texture -> leaves seen so far (a repeated texture gets a `~n` suffix)
  const slideMediaDir = join(outDir, 'media', uuid);
  const relMedia = (p) => relative(outDir, p).split('\\').join('/');
  const common = (leaf, id) => {
    const o = { id, box: roundBox(leaf.box) };
    if (leaf.hidden) o.hidden = true;
    if (leaf.opacity < 1) o.opacity = Math.round(leaf.opacity * 1000) / 1000;
    return o;
  };
  // an image placed inside a <g opacity> on its page multiplies that into the element's opacity
  const withOpacity = (o, a) => {
    if (a === undefined || a === null || a >= 1) return o;
    return { ...o, opacity: Math.round((o.opacity ?? 1) * a * 1000) / 1000 };
  };
  // the element id of a leaf: its texture, or `<texture>~n` for the n-th leaf that repeats a texture
  // (slide 22 places 36 glyph textures more than once for its typewriter build)
  const idFor = (leaf) => {
    const n = (occurrences.get(leaf.texture) || 0) + 1;
    occurrences.set(leaf.texture, n);
    if (n > 1) report.repeatedTextures = (report.repeatedTextures || 0) + 1;
    return n === 1 ? leaf.texture : `${leaf.texture}~${n}`;
  };
  const rasterElement = (leaf, asset, tr, note) => {
    const media = rasterize(pdf, asset.index, join(slideMediaDir, `${leaf.texture}.png`));
    report.bytes.rasters += media.bytes;
    report.media.push({ id: leaf.texture, kind: 'image', how: 'raster', note, bytes: media.bytes, width: media.width, height: media.height, scale: 1 });
    return { ...common(leaf, leaf.texture), kind: 'image', src: relMedia(media.file), scale: 1, source: { path: 'texture', kpf: kpfRef(uuid, leaf.texture, asset, tr) } };
  };
  const pushElement = (el, texture, leaf = null) => {
    elements.push(el);
    if (!idOfTexture.has(texture)) idOfTexture.set(texture, el.id);
    if (leaf) elementsOfTexture.set(texture, [...(elementsOfTexture.get(texture) || []), { id: el.id, leaf }]);
    report.elements[el.kind] += 1;
    report.sourcePath[el.source.path] += 1;
  };

  for (const leaf of plan.content) {
    const texture = leaf.texture;
    const asset = assets[texture];
    const tr = leaf.layer.texturedRectangle;
    const baseId = idFor(leaf);

    if (videos.has(texture)) {
      const v = videos.get(texture);
      const movie = assets[v.movieAsset];
      const gif = await fetchAsset(kpf, uuid, movie.url.native);
      const t = transcodeGif(gif.file, join(outDir, 'media', 'shared'));
      const posterAsset = v.posterTexture ? assets[v.posterTexture] : asset;
      const el = {
        ...common(leaf, v.posterTexture || baseId),
        kind: 'video',
        src: { mp4: relMedia(t.mp4), webm: relMedia(t.webm) },
        poster: relMedia(t.poster),
        loop: v.loopMode !== 'none',
        source: { path: 'texture', kpf: kpfRef(uuid, v.posterTexture || texture, posterAsset, tr), originalGif: basename(movie.url.native), originalBytes: t.originalBytes, transparent: t.transparent },
      };
      pushElement(el, texture, leaf);
      if (v.posterTexture) idOfTexture.set(v.posterTexture, el.id);
      if (v.still) report.stills.push(v.still);
      if (!t.reused) report.bytes.video += t.bytes.mp4 + t.bytes.webm + t.bytes.poster;
      report.media.push({ id: el.id, kind: 'video', sha12: t.sha12, originalBytes: t.originalBytes, mp4: t.bytes.mp4, webm: t.bytes.webm, poster: t.bytes.poster, transparent: t.transparent, reused: t.reused, gif: basename(movie.url.native) });
      continue;
    }

    const content = pageToElements(page(texture), leaf);
    const ref = kpfRef(uuid, texture, asset, tr);
    if (content.clipStats) {
      const c = report.clips;
      const add = (dst, src) => { for (const k of Object.keys(src)) { if (typeof src[k] === 'object') add(dst[k], src[k]); else dst[k] += src[k]; } };
      add(c, content.clipStats);
    }

    if (content.kind === 'text' || content.kind === 'mixed') {
      // a word with characters carries no `d` of its own: its outline is the characters' outlines in order
      // (the player joins them); writing both doubled deck.json to 20 MB
      const words = content.words.map((w) => (w.chars?.length ? Object.fromEntries(Object.entries(w).filter(([k]) => k !== 'd')) : w));
      const el = { ...common(leaf, baseId), kind: 'text', words, fill: content.fill, text: content.text };
      // body paths the page paints after its last glyph draw over the text (slide 62 paints a black box over
      // the clipped edge of its Result block); the others stay on the text element, under the glyphs
      let textPaths = content.paths;
      const overText = () => textPaths.filter((p) => p.order > content.lastGlyph);
      const setTextPaths = (list) => {
        textPaths = list;
        const under = list.filter((p) => !(p.order > content.lastGlyph));
        if (under.length) el.paths = under.map(stripOrder);
        else delete el.paths;
      };
      setTextPaths(content.paths);
      el.source = { path: 'pdf', kpf: ref };
      if (keyTokens && content.words.every((w) => keyTokens.has(w.text))) report.keyTextMatched += 1;
      if (content.kind === 'mixed') {
        // one image element per placement, matched to the page's streams by their pixels (D-023 R-1). The
        // images draw under the text: on 30 of the 40 mixed pages every image precedes every glyph in the
        // page's order, on the other 10 each image precedes the glyphs of its own row (slide 12 draws a
        // bar, then a row of text, then the next bar); `mixedInterleaved` counts the latter
        report.mixedPages += 1;
        const firstGlyph = Math.min(...(page(texture).uses.map((u) => u.order ?? 0)));
        if (content.images.some((pl) => (pl.order ?? 0) > firstGlyph)) report.mixedInterleaved += 1;
        const scratch = join(CACHE, 'extract', uuid, texture);
        const { images: streams, fontFilesDeleted } = extractPageImages(pdf, asset.index, scratch, { keys: true });
        report.fontFilesDeleted += fontFilesDeleted;
        // a stream may be placed more than once on a page (slide 39 draws each badge twice), so the match
        // never consumes a stream; the file of the first placement is reused by the later ones
        const { matched, sizeFallbacks } = matchStreams(content.images, streams);
        report.imageSizeFallbacks += sizeFallbacks;
        if (matched.every(Boolean)) {
          const placed = new Map(); // stream object -> file
          // the body paths split around the images by page order (D-019 F-01): the paths before an image
          // become a shape element under it (slide 60 paints its red box, then a 75 percent black image
          // over it); the paths after the last image stay on the text element, over every image
          const layers = mixedLayers(content.paths, content.images);
          setTextPaths(layers[layers.length - 1].paths);
          let seg = 0;
          for (const layer of layers) {
            if (layer.kind === 'paths') {
              const sid = `${baseId}-p${seg++}`;
              pushElement({ ...common(leaf, sid), kind: 'shape', paths: layer.paths.map(stripOrder), source: { path: 'pdf', kpf: ref } }, sid);
              continue;
            }
            if (layer.kind !== 'image') continue;
            const k = layer.index;
            const pl = content.images[k];
            const img = matched[k];
            if (!placed.has(img.object)) placed.set(img.object, placeImage(img, slideMediaDir, `${baseId.replace('~', '-')}-${k}`));
            const file = placed.get(img.object);
            const scale = Math.round((img.width / pl.box.w) * 10000) / 10000;
            const { box, crop } = visibleImage(pl.box, leaf.box, img.width, img.height);
            const firstUse = file.endsWith(`-${k}.${img.ext}`);
            if (firstUse) report.bytes.streams += img.bytes;
            report.media.push({ id: `${baseId}-${k}`, kind: 'image', how: 'stream', bytes: firstUse ? img.bytes : 0, width: img.width, height: img.height, scale, cropped: !!crop, reused: !firstUse });
            if (pl.flipY) report.flippedImages += 1;
            pushElement({ ...withOpacity(common(leaf, `${baseId}-${k}`), pl.opacity), box, kind: 'image', src: relMedia(file), scale, ...placementFields(pl, crop, img.height), source: { path: 'texture', kpf: ref } }, `${baseId}-${k}`);
          }
          if (seg) report.mixedPathSplits += 1;
        } else {
          report.mixedFallbacks += 1;
          report.textTextureFallbacks += 1;
          pushElement({ ...rasterElement(leaf, asset, tr, 'mixed page: streams did not match the placements'), id: `${baseId}-raster` }, `${baseId}-raster`);
        }
        rmSync(scratch, { recursive: true, force: true });
      }
      pushElement(el, texture, leaf);
      const over = overText();
      if (over.length) {
        report.textPathsOver += 1;
        pushElement({ ...common(leaf, `${baseId}-fg`), kind: 'shape', paths: over.map(stripOrder), source: { path: 'pdf', kpf: ref } }, `${baseId}-fg`);
      }
      continue;
    }

    if (content.kind === 'shape') {
      pushElement({ ...common(leaf, baseId), kind: 'shape', paths: content.paths.map(stripOrder), source: { path: 'pdf', kpf: ref } }, texture, leaf);
      continue;
    }

    if (content.kind === 'picture') {
      // exactly one placement: the embedded stream; otherwise a 1x raster of the page (design, Media)
      let el = null;
      if (content.images.length === 1) {
        const scratch = join(CACHE, 'extract', uuid, texture);
        const { images: streams, fontFilesDeleted } = extractPageImages(pdf, asset.index, scratch);
        report.fontFilesDeleted += fontFilesDeleted;
        if (streams.length === 1) {
          const img = streams[0];
          const pl = content.images[0];
          const file = placeImage(img, slideMediaDir, baseId.replace('~', '-'));
          const scale = Math.round((img.width / pl.box.w) * 10000) / 10000;
          const { box, crop } = visibleImage(pl.box, leaf.box, img.width, img.height);
          report.bytes.streams += img.bytes;
          report.pictures.stream += 1;
          report.media.push({ id: baseId, kind: 'image', how: 'stream', bytes: img.bytes, width: img.width, height: img.height, scale, cropped: !!crop });
          if (pl.flipY) report.flippedImages += 1;
          el = { ...withOpacity(common(leaf, baseId), pl.opacity), box, kind: 'image', src: relMedia(file), scale, ...placementFields(pl, crop, img.height), source: { path: 'texture', kpf: ref } };
        }
        rmSync(scratch, { recursive: true, force: true });
      }
      if (!el) {
        report.pictures.raster += 1;
        el = { ...rasterElement(leaf, asset, tr, `${content.images.length} placements`), id: baseId };
        pushElement(el, texture, leaf);
        continue;
      }
      // the body paths of a single-image picture page (six pages deck-wide: a panel background under the
      // image, or dark bars over its edges) become shape elements under and over the image by page order;
      // a raster page already carries them
      const imageOrder = content.images[0].order ?? 0;
      const under = content.paths.filter((p) => p.order < imageOrder);
      const over = content.paths.filter((p) => p.order > imageOrder);
      if (under.length) { report.pictureShapes.under += 1; pushElement({ ...common(leaf, `${baseId}-bg`), kind: 'shape', paths: under.map(stripOrder), source: { path: 'pdf', kpf: ref } }, `${baseId}-bg`); }
      pushElement(el, texture, leaf);
      if (over.length) { report.pictureShapes.over += 1; pushElement({ ...common(leaf, `${baseId}-fg`), kind: 'shape', paths: over.map(stripOrder), source: { path: 'pdf', kpf: ref } }, `${baseId}-fg`); }
      continue;
    }
    report.skipped.push({ texture, reason: `content ${content.kind}` });
  }

  // builds
  const textOf = new Map(elements.filter((e) => e.kind === 'text').map((e) => [e.id, e]));
  // the element ids an effect leaf targets, aligned with the leaves. A leaf matches the elements of its
  // texture; when the texture repeats in the first event, the nearest by local position (ties keep all:
  // slide 25 places one glyph twice at one point). A mixed page's images share the texture and build with
  // its text.
  const localPos = (l) => [l.initialState?.position?.pointX ?? 0, l.initialState?.position?.pointY ?? 0];
  const targetsOf = (effect, effLeaves) =>
    effLeaves.map((l) => {
      const owners = elementsOfTexture.get(l.texture) || [];
      if (!owners.length) return null;
      let picked = owners;
      if (owners.length > 1) {
        const [x, y] = localPos(l);
        const dist = owners.map((o) => { const [ox, oy] = localPos(o.leaf.layer); return Math.hypot(ox - x, oy - y); });
        const best = Math.min(...dist);
        picked = owners.filter((_, i) => dist[i] - best < 1);
      }
      const ids = [];
      for (const o of picked) {
        ids.push(o.id);
        for (const [t, eid] of idOfTexture) if (t.startsWith(`${o.id}-`) && !ids.includes(eid)) ids.push(eid);
      }
      return ids;
    });
  const unitOf = (effect, targets) => {
    if (effect.name !== 'apple:move in') return null;
    return targets.every((id) => textOf.has(id) && textOf.get(id).words.length === 1) ? 'word' : null;
  };
  const b = collectBuilds(slide, targetsOf, { unitOf });
  report.builds = b.builds.length;
  report.steps = b.steps;
  report.unknownEffects = b.unknown;
  report.mappedEffects = b.mapped;
  report.directionChecks = b.directionChecks;
  report.skippedEffects = b.skipped;
  const built = new Set(b.builds.flatMap((x) => x.targets));
  for (const e of elements) if (e.hidden && !built.has(e.id)) report.orphans.push(e.id);

  // snapshots: composites of the first event that had other content, plus every texture read elsewhere and not drawn
  const snapshots = plan.snapshots.map((l) => l.texture);
  const seen = new Set(snapshots);
  const noteSnapshot = (l) => {
    if (!l.texturedRectangle || !l.texture || seen.has(l.texture)) return;
    seen.add(l.texture);
    if (!idOfTexture.has(l.texture) && !videos.has(l.texture) && assets[l.texture] && l.texture !== plan.background?.texture) snapshots.push(l.texture);
  };
  for (const ev of slide.events) {
    walkLayers(ev.baseLayer, noteSnapshot);
    walkEffects(ev.effects, (e) => walkLayers(e.baseLayer, noteSnapshot));
  }
  const stills = [...new Set([...[...videos.keys()].filter((t) => idOfTexture.has(t) && idOfTexture.get(t) !== t), ...report.stills])];

  // composite check: every word drawn from a text page also appears in a composite snapshot of this slide
  const elementWords = elements.filter((e) => e.kind === 'text').flatMap((e) => e.words.map((w) => w.text));
  const compositeWords = new Map();
  for (const t of snapshots) {
    const a = assets[t];
    if (!a || a.width !== 1920 || a.height !== 1080) continue;
    const p = page(t);
    if (!p.uses.length) continue;
    withAdvances(p);
    compositeWords.set(t, wordsFromUses(p.uses).map((w) => w.text));
  }
  if (elementWords.length) {
    const pool = new Map();
    for (const ws of compositeWords.values()) for (const w of ws) pool.set(w, (pool.get(w) || 0) + 1);
    const missing = [];
    for (const w of elementWords) {
      if (pool.get(w) > 0) pool.set(w, pool.get(w) - 1);
      else missing.push(w);
    }
    report.composite = { composites: [...compositeWords.keys()], wordsInElements: elementWords.length, wordsInComposites: [...compositeWords.values()].reduce((n, ws) => n + ws.length, 0), missing, note: compositeWords.size ? null : 'no composite snapshot with glyphs on this slide' };
  }

  const out = { id: uuid, index: index1, background, elements, builds: b.builds, transition: transitionOf(slide) };
  if (snapshots.length || stills.length || plan.compositeAsContent) {
    out.kpf = { snapshots, stills };
    if (plan.compositeAsContent) out.kpf.compositeAsContent = true;
  }
  log(`slide ${index1} ${uuid.slice(0, 8)}: ${elements.length} elements (${report.elements.text} text, ${report.elements.image} image, ${report.elements.video} video, ${report.elements.shape} shape), ${b.builds.length} builds in ${b.steps} steps, transition ${out.transition.kind}${out.transition.direction ? ' ' + out.transition.direction : ''}${plan.compositeAsContent ? ', composite as content' : ''}`);
  return { slide: out, report };
}

/** Every media path deck.json references, relative to its directory. */
export function referencedMedia(deck) {
  const out = new Set();
  for (const s of deck.slides) {
    for (const e of s.elements) {
      if (e.kind === 'image') out.add(e.src);
      else if (e.kind === 'video') { out.add(e.src.mp4); out.add(e.src.webm); out.add(e.poster); }
    }
  }
  return out;
}

/** Delete every file under `outDir/media` that `deck` does not reference, and empty directories. Returns the paths deleted. */
export function pruneMedia(outDir, deck) {
  const keep = referencedMedia(deck);
  const deleted = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, name.name);
      if (name.isDirectory()) {
        walk(file);
        if (!readdirSync(file).length) rmdirSync(file);
      } else if (!keep.has(relative(outDir, file).split('\\').join('/'))) {
        unlinkSync(file);
        deleted.push(relative(outDir, file));
      }
    }
  };
  const mediaDir = join(outDir, 'media');
  try { walk(mediaDir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return deleted;
}

export async function main(argv) {
  const o = parseArgs(argv);
  const log = (m) => console.error(m);
  const outDir = o.out;
  mkdirSync(outDir, { recursive: true });
  const header = await loadHeader(o.kpf);
  const selected = o.slides || header.slideList.map((_, i) => i + 1);

  // .key: strings only. The harvest has no run-to-font link, so the font condition of the key path is not
  // evaluable and every text element stays `pdf`; the token match is recorded for the report.
  let keyParse = null;
  let keyTokens = null;
  if (o.key) {
    const { summary, strings } = await parseKeyGuarded(resolve(o.key), { fonts: header.fonts, budgetMs: o.keyBudgetMs }, { timeoutMs: KEY_TIMEOUT_MS });
    keyTokens = new Set();
    for (const s of strings) for (const t of s.split(/\s+/)) if (t) keyTokens.add(t);
    keyParse = {
      attempted: true,
      stage: summary.stage,
      reason: summary.error || (summary.budgetExhausted ? 'budget exhausted' : 'strings harvested; no run-to-font association, so the font condition of the key path is not evaluable'),
      strings: summary.strings,
      textMatched: 0,
      textTotal: 0,
      fontCondition: 'not evaluable',
    };
    log(`key: ${summary.verdict}, ${summary.strings} strings in ${summary.wallMs} ms (${summary.stage})`);
  }

  const ctx = { kpf: o.kpf, outDir, keyTokens, log };
  const slides = [];
  const reports = [];
  for (const index1 of selected) {
    const uuid = header.slideList[index1 - 1];
    if (!uuid) throw new Error(`no slide ${index1}`);
    const { slide, report } = await convertSlide(ctx, index1, uuid, await loadSlide(o.kpf, uuid));
    slides.push(slide);
    reports.push(report);
    if (keyParse) {
      keyParse.textMatched += report.keyTextMatched;
      keyParse.textTotal += report.elements.text;
    }
  }

  const convertedAt = git(['log', '-1', '--format=%cI'], '1970-01-01T00:00:00+00:00');
  const deck = {
    format: 'kinetic/1',
    id: basename(outDir),
    title: header.title,
    width: header.slideWidth,
    height: header.slideHeight,
    source: {
      kpf: o.kpf,
      key: o.key ? resolve(o.key).split('/').slice(-2).join('/') : null,
      convertedAt: new Date(convertedAt).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      converter: git(['rev-parse', '--short', 'HEAD'], '0000000'),
      ...(keyParse ? { keyParse } : {}),
    },
    slides,
  };
  const deckPath = join(outDir, 'deck.json');
  writeFileSync(deckPath, JSON.stringify(deck, null, 2) + '\n');
  // a full run owns media/: files of an earlier run that no element references are removed (a partial
  // run keeps them, since its deck.json lists only the selected slides)
  const pruned = o.slides ? [] : pruneMedia(outDir, deck);
  if (pruned.length) log(`pruned ${pruned.length} unreferenced media file(s)`);
  const summaryPath = join(CACHE, 'convert-summary.json');
  writeFileSync(summaryPath, JSON.stringify({ deck: deckPath, keyParse, pruned, slides: reports }, null, 2) + '\n');
  log(`wrote ${deckPath} (${slides.length} slides); summary in ${relative(PROJECT, summaryPath)}`);

  const { ok, errors } = validateDeck(JSON.parse(readFileSync(deckPath, 'utf8')));
  if (!ok) {
    log(`invalid deck.json, first ${errors.length} error(s):`);
    for (const e of errors) log('  ' + formatError(e));
    return 1;
  }
  log('valid: deck.json');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
}
