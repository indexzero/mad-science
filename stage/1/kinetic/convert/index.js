// Converter CLI. Reads a KPF export (URL or directory) plus the .key, writes decks/<id>/deck.json and media/.
//   node convert/index.js --kpf https://all-docs.talks.charlie.dev/ --key <path>.key --out decks/_all_docs --slides 1,2,4
// Idempotent: `source.convertedAt` is the committer date of HEAD and `source.converter` its short sha, so a
// second run at the same HEAD writes byte-identical output. Validation runs last and sets the exit code.
// A run summary for REPORT-1.md goes to .cache/convert-summary.json.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIVE_BASE, loadHeader, loadSlide, fetchAsset } from './kpf.js';
import { composeLeaves, roundBox } from './layout.js';
import { parsePage, pageToElements, classifyPage, wordsFromUses, withAdvances, DEFAULT_FILL } from './pdf.js';
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
    compositeAsContent: false,
    orphans: [],
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

  // video placements: a renderMovie effect names the GIF; its baseLayer holds the video layer and the still
  const videos = new Map(); // still texture -> { movieAsset, posterTexture, loopMode }
  const posterTextures = new Set();
  for (const ev of slide.events) {
    walkEffects(ev.effects, (e) => {
      if (!e.movie?.asset || !assets[e.movie.asset]) return;
      let videoLeaf = null;
      const stills = [];
      walkLayers(e.baseLayer, (l) => {
        if (l.isVideoLayer) videoLeaf = l;
        else if (l.texturedRectangle && l.texture) stills.push(l);
      });
      if (videoLeaf?.texture) posterTextures.add(videoLeaf.texture);
      for (const s of stills) videos.set(s.texture, { movieAsset: e.movie.asset, posterTexture: videoLeaf?.texture ?? null, loopMode: e.movie.loopMode });
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
  const idOfTexture = new Map();
  const slideMediaDir = join(outDir, 'media', uuid);
  const relMedia = (p) => relative(outDir, p).split('\\').join('/');
  const common = (leaf, id) => {
    const o = { id, box: roundBox(leaf.box) };
    if (leaf.hidden) o.hidden = true;
    if (leaf.opacity < 1) o.opacity = Math.round(leaf.opacity * 1000) / 1000;
    return o;
  };
  const rasterElement = (leaf, asset, tr, note) => {
    const media = rasterize(pdf, asset.index, join(slideMediaDir, `${leaf.texture}.png`));
    report.bytes.rasters += media.bytes;
    report.media.push({ id: leaf.texture, kind: 'image', how: 'raster', note, bytes: media.bytes, width: media.width, height: media.height, scale: 1 });
    return { ...common(leaf, leaf.texture), kind: 'image', src: relMedia(media.file), scale: 1, source: { path: 'texture', kpf: kpfRef(uuid, leaf.texture, asset, tr) } };
  };
  const pushElement = (el, texture) => {
    elements.push(el);
    idOfTexture.set(texture, el.id);
    report.elements[el.kind] += 1;
    report.sourcePath[el.source.path] += 1;
  };

  for (const leaf of plan.content) {
    const texture = leaf.texture;
    const asset = assets[texture];
    const tr = leaf.layer.texturedRectangle;

    if (videos.has(texture)) {
      const v = videos.get(texture);
      const movie = assets[v.movieAsset];
      const gif = await fetchAsset(kpf, uuid, movie.url.native);
      const t = transcodeGif(gif.file, join(outDir, 'media', 'shared'));
      const posterAsset = v.posterTexture ? assets[v.posterTexture] : asset;
      const el = {
        ...common(leaf, v.posterTexture || texture),
        kind: 'video',
        src: { mp4: relMedia(t.mp4), webm: relMedia(t.webm) },
        poster: relMedia(t.poster),
        loop: v.loopMode !== 'none',
        source: { path: 'texture', kpf: kpfRef(uuid, v.posterTexture || texture, posterAsset, tr), originalGif: basename(movie.url.native), originalBytes: t.originalBytes, transparent: t.transparent },
      };
      pushElement(el, texture);
      if (v.posterTexture) idOfTexture.set(v.posterTexture, el.id);
      if (!t.reused) report.bytes.video += t.bytes.mp4 + t.bytes.webm + t.bytes.poster;
      report.media.push({ id: el.id, kind: 'video', sha12: t.sha12, originalBytes: t.originalBytes, mp4: t.bytes.mp4, webm: t.bytes.webm, poster: t.bytes.poster, transparent: t.transparent, reused: t.reused, gif: basename(movie.url.native) });
      continue;
    }

    const content = pageToElements(page(texture), leaf);
    const ref = kpfRef(uuid, texture, asset, tr);

    if (content.kind === 'text' || content.kind === 'mixed') {
      const el = { ...common(leaf, texture), kind: 'text', words: content.words, fill: content.fill, text: content.text };
      if (content.paths.length) el.paths = content.paths;
      el.source = { path: 'pdf', kpf: ref };
      if (keyTokens && content.words.every((w) => keyTokens.has(w.text))) report.keyTextMatched += 1;
      pushElement(el, texture);
      if (content.kind === 'mixed') {
        // one image element per placement, matched to the page's streams by pixel size (D-009 F2)
        report.mixedPages += 1;
        const scratch = join(CACHE, 'extract', uuid, texture);
        const { images: streams, fontFilesDeleted } = extractPageImages(pdf, asset.index, scratch);
        report.fontFilesDeleted += fontFilesDeleted;
        const pool = [...streams];
        const matched = content.images.map((pl) => {
          const i = pool.findIndex((s) => s.width === pl.width && s.height === pl.height);
          return i < 0 ? null : pool.splice(i, 1)[0];
        });
        if (matched.every(Boolean)) {
          content.images.forEach((pl, k) => {
            const img = matched[k];
            const file = placeImage(img, slideMediaDir, `${texture}-${k}`);
            const scale = Math.round((img.width / pl.box.w) * 10000) / 10000;
            const { box, crop } = visibleImage(pl.box, leaf.box, img.width, img.height);
            report.bytes.streams += img.bytes;
            report.media.push({ id: `${texture}-${k}`, kind: 'image', how: 'stream', bytes: img.bytes, width: img.width, height: img.height, scale, cropped: !!crop });
            pushElement({ ...common(leaf, `${texture}-${k}`), box, kind: 'image', src: relMedia(file), scale, ...(crop ? { crop } : {}), source: { path: 'texture', kpf: ref } }, `${texture}-${k}`);
          });
        } else {
          report.mixedFallbacks += 1;
          pushElement({ ...rasterElement(leaf, asset, tr, 'mixed page: streams did not match the placements'), id: `${texture}-raster` }, `${texture}-raster`);
        }
        rmSync(scratch, { recursive: true, force: true });
      }
      continue;
    }

    if (content.kind === 'shape') {
      pushElement({ ...common(leaf, texture), kind: 'shape', paths: content.paths, source: { path: 'pdf', kpf: ref } }, texture);
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
          const file = placeImage(img, slideMediaDir, texture);
          const scale = Math.round((img.width / pl.box.w) * 10000) / 10000;
          const { box, crop } = visibleImage(pl.box, leaf.box, img.width, img.height);
          report.bytes.streams += img.bytes;
          report.pictures.stream += 1;
          report.media.push({ id: texture, kind: 'image', how: 'stream', bytes: img.bytes, width: img.width, height: img.height, scale, cropped: !!crop });
          el = { ...common(leaf, texture), box, kind: 'image', src: relMedia(file), scale, ...(crop ? { crop } : {}), source: { path: 'texture', kpf: ref } };
        }
        rmSync(scratch, { recursive: true, force: true });
      }
      if (!el) {
        report.pictures.raster += 1;
        el = rasterElement(leaf, asset, tr, `${content.images.length} placements`);
      }
      pushElement(el, texture);
      continue;
    }
    report.skipped.push({ texture, reason: `content ${content.kind}` });
  }

  // builds
  const textOf = new Map(elements.filter((e) => e.kind === 'text').map((e) => [e.id, e]));
  const targetsOf = (effect, effLeaves) => {
    const ids = [];
    for (const l of effLeaves) {
      const id = idOfTexture.get(l.texture);
      if (id && !ids.includes(id)) ids.push(id);
      // a mixed page's images share the texture: they build with the text
      for (const [t, eid] of idOfTexture) if (t.startsWith(`${l.texture}-`) && !ids.includes(eid)) ids.push(eid);
    }
    return ids;
  };
  const unitOf = (effect, targets) => {
    if (effect.name !== 'apple:move in') return null;
    return targets.every((id) => textOf.has(id) && textOf.get(id).words.length === 1) ? 'word' : null;
  };
  const b = collectBuilds(slide, targetsOf, { unitOf });
  report.builds = b.builds.length;
  report.steps = b.steps;
  report.unknownEffects = b.unknown;
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
  const stills = [...videos.keys()].filter((t) => idOfTexture.has(t) && idOfTexture.get(t) !== t);

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
  const summaryPath = join(CACHE, 'convert-summary.json');
  writeFileSync(summaryPath, JSON.stringify({ deck: deckPath, keyParse, slides: reports }, null, 2) + '\n');
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
