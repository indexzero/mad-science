// Census of a KPF export: per-slide layout, assets, effects (two populations),
// textureType and isBackgroundTexture, layer state, and videos (by sha256 of bytes).
// CLI: node convert/census.js [--kpf <url or dir>] [--json <out>] [--md <out>] [--no-gifs]
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { LIVE_BASE, loadHeader, loadSlide, fetchAsset } from './kpf.js';

const IDENTITY_4X4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function inc(map, key, by = 1) {
  map[key] = (map[key] || 0) + by;
}

function sortedCounts(map) {
  return Object.fromEntries(Object.entries(map).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))));
}

/** Walk every layer under a root, at every depth. Calls fn(layer, depth, path). */
export function walkLayers(root, fn, depth = 0, path = '') {
  if (!root) return;
  fn(root, depth, path);
  (root.layers || []).forEach((child, i) => walkLayers(child, fn, depth + 1, `${path}/${i}`));
}

/** Walk every effect, nested effects included. Calls fn(effect, depth, path). */
export function walkEffects(effects, fn, depth = 0, path = '') {
  (effects || []).forEach((e, i) => {
    fn(e, depth, `${path}/${i}`);
    walkEffects(e.effects, fn, depth + 1, `${path}/${i}`);
  });
}

/** Every baseLayer root of a slide: each event's, and each effect's at every depth. */
export function eachBaseLayer(slide, fn) {
  for (const [i, ev] of slide.events.entries()) {
    fn(ev.baseLayer, `event${i}`);
    walkEffects(ev.effects, (e, d, p) => fn(e.baseLayer, `event${i}.effects${p}:${e.name}`));
  }
}

/** Census of one slide. `index1` is the 1-based slide number. */
export function censusSlide(index1, uuid, slide) {
  const assets = Object.entries(slide.assets);
  const textures = assets.filter(([, a]) => a.type === 'texture');
  const videos = assets.filter(([, a]) => a.type === 'video');

  const topLevel = { transition: {}, buildIn: {}, other: {} };
  const topLevelNames = [];
  const transitions = [];
  for (const ev of slide.events) {
    for (const e of ev.effects) {
      const bucket = topLevel[e.type] || topLevel.other;
      inc(bucket, e.name);
      if (e.type === 'transition') {
        transitions.push({ name: e.name, direction: e.attributes?.direction ?? null, duration: e.duration });
      } else {
        topLevelNames.push(e.name);
      }
    }
  }

  const recursive = {};
  const pushDirections = {};
  const moviePlacements = [];
  for (const ev of slide.events) {
    walkEffects(ev.effects, (e) => {
      inc(recursive, e.name);
      if (e.name === 'apple:push') inc(pushDirections, String(e.attributes?.direction));
      if (e.movie) {
        const asset = slide.assets[e.movie.asset];
        moviePlacements.push({
          effect: e.name,
          asset: e.movie.asset,
          url: asset?.url?.native ?? null,
          width: asset?.width ?? null,
          height: asset?.height ?? null,
          loopMode: e.movie.loopMode,
          startTime: e.movie.startTime,
          endTime: e.movie.endTime,
        });
      }
    });
  }

  const textureType = {};
  const isBackgroundTexture = {};
  const layerState = {
    layers: 0,
    textureLeaves: 0,
    textureLeavesInEventBaseLayers: 0,
    hiddenTextureLeaves: 0,
    hiddenTextureLeavesInEventBaseLayers: 0,
    layersInEventBaseLayers: 0,
    opacityBelowOneInEventBaseLayers: 0,
    sublayerPerspectiveInEventBaseLayers: 0,
    videoLayers: 0,
    opacityBelowOne: 0,
    sublayerIdentity: 0,
    sublayerPerspective: 0,
    sublayerOther: 0,
    masksToBoundsTrue: 0,
    edgeAntialiasingMask: {},
    shapePathCarriers: 0,
    shapePathElements: 0,
    infoShapePathCarriers: 0,
    infoShapePathElements: 0,
    textColor: 0,
  };
  eachBaseLayer(slide, (root, where) => {
    const inEvent = !where.includes('.effects');
    walkLayers(root, (l) => {
      layerState.layers += 1;
      if (inEvent) layerState.layersInEventBaseLayers += 1;
      const st = l.initialState || {};
      if (st.opacity !== undefined && st.opacity < 1) {
        layerState.opacityBelowOne += 1;
        if (inEvent) layerState.opacityBelowOneInEventBaseLayers += 1;
      }
      if (st.masksToBounds === true) layerState.masksToBoundsTrue += 1;
      if (st.edgeAntialiasingMask !== undefined) inc(layerState.edgeAntialiasingMask, String(st.edgeAntialiasingMask));
      const slt = st.sublayerTransform;
      if (Array.isArray(slt)) {
        if (slt.every((v, i) => v === IDENTITY_4X4[i])) layerState.sublayerIdentity += 1;
        else if (slt.length === 16 && slt[11] !== 0 && slt.every((v, i) => i === 11 || v === IDENTITY_4X4[i])) {
          layerState.sublayerPerspective += 1;
          if (inEvent) layerState.sublayerPerspectiveInEventBaseLayers += 1;
        }
        else layerState.sublayerOther += 1;
      }
      if (l.isVideoLayer) layerState.videoLayers += 1;
      if (l.texturedRectangle) {
        const tr = l.texturedRectangle;
        layerState.textureLeaves += 1;
        if (inEvent) layerState.textureLeavesInEventBaseLayers += 1;
        if (st.hidden === true) {
          layerState.hiddenTextureLeaves += 1;
          if (inEvent) layerState.hiddenTextureLeavesInEventBaseLayers += 1;
        }
        inc(textureType, String(tr.textureType));
        inc(isBackgroundTexture, String(tr.isBackgroundTexture));
        if (tr.shapePath?.elements) {
          layerState.shapePathCarriers += 1;
          layerState.shapePathElements += tr.shapePath.elements.length;
        }
        if (tr.repGenerationDictionary?.infoShapePath) {
          layerState.infoShapePathCarriers += 1;
          layerState.infoShapePathElements += (tr.repGenerationDictionary.infoShapePath.elements || []).length;
        }
        if (tr.textColor !== undefined) layerState.textColor += 1;
      }
    });
  });

  return {
    index: index1,
    uuid,
    scenes: slide.events.length,
    textures: textures.length,
    videos: videos.length,
    transition: transitions.length === 1 ? transitions[0] : transitions,
    topLevelBuildNames: topLevelNames,
    topLevel,
    recursive,
    pushDirections,
    moviePlacements,
    textureType,
    isBackgroundTexture,
    layerState,
    assets: assets.map(([id, a]) => ({ id, type: a.type, index: a.index, url: a.url.native, width: a.width, height: a.height })),
  };
}

function mergeCounts(into, from) {
  for (const [k, v] of Object.entries(from)) inc(into, k, v);
}

/** Aggregate per-slide census into the deck census. `gifs` is the optional map url -> { sha256, bytes } filled by fetchGifs. */
export function censusDeck(slideCensuses, gifs = null) {
  const assetCensus = { types: {}, extensions: {}, distinctSizes: new Set(), full1920x1080: 0, textures: 0, videos: 0 };
  const topLevel = { transition: {}, buildIn: {}, other: {} };
  const recursive = {};
  const pushDirections = {};
  const textureType = {};
  const isBackgroundTexture = {};
  const layerState = { edgeAntialiasingMask: {} };
  const placements = [];
  let scenes = 0;

  for (const s of slideCensuses) {
    scenes += s.scenes;
    for (const a of s.assets) {
      inc(assetCensus.types, a.type);
      inc(assetCensus.extensions, a.url.split('.').pop().toLowerCase());
      assetCensus.distinctSizes.add(`${a.width}x${a.height}`);
      if (a.type === 'texture') {
        assetCensus.textures += 1;
        if (a.width === 1920 && a.height === 1080) assetCensus.full1920x1080 += 1;
      } else if (a.type === 'video') {
        assetCensus.videos += 1;
      }
    }
    for (const k of Object.keys(topLevel)) mergeCounts(topLevel[k], s.topLevel[k] || {});
    mergeCounts(recursive, s.recursive);
    mergeCounts(pushDirections, s.pushDirections);
    mergeCounts(textureType, s.textureType);
    mergeCounts(isBackgroundTexture, s.isBackgroundTexture);
    for (const [k, v] of Object.entries(s.layerState)) {
      if (typeof v === 'number') inc(layerState, k, v);
      else mergeCounts(layerState.edgeAntialiasingMask, v);
    }
    for (const p of s.moviePlacements) placements.push({ slide: s.index, uuid: s.uuid, ...p });
  }

  const basenames = new Set(placements.map((p) => p.url.split('/').pop()));
  const video = {
    placements: placements.length,
    slidesWithVideo: new Set(placements.map((p) => p.slide)).size,
    maxPerSlide: Math.max(0, ...Object.values(placements.reduce((m, p) => (inc(m, p.slide), m), {}))),
    distinctBasenames: basenames.size,
    distinctUrlPaths: new Set(placements.map((p) => `${p.uuid}/${p.url}`)).size,
    maxWidth: Math.max(0, ...placements.map((p) => p.width || 0)),
    byBasename: sortedCounts(placements.reduce((m, p) => (inc(m, p.url.split('/').pop()), m), {})),
    placementsList: placements,
  };
  if (gifs) {
    const bySha = new Map();
    let placementBytes = 0;
    for (const p of placements) {
      const g = gifs[`${p.uuid}/${p.url}`];
      if (!g) continue;
      placementBytes += g.bytes;
      p.sha256 = g.sha256;
      p.bytes = g.bytes;
      if (!bySha.has(g.sha256)) bySha.set(g.sha256, { sha256: g.sha256, bytes: g.bytes, basenames: new Set(), placements: 0 });
      const d = bySha.get(g.sha256);
      d.basenames.add(p.url.split('/').pop());
      d.placements += 1;
    }
    const distinct = [...bySha.values()].sort((a, b) => b.bytes - a.bytes);
    video.distinctBySha256 = distinct.length;
    video.distinctBytes = distinct.reduce((n, d) => n + d.bytes, 0);
    video.placementBytes = placementBytes;
    video.largest = distinct.slice(0, 10).map((d) => ({ sha256: d.sha256, bytes: d.bytes, basenames: [...d.basenames], placements: d.placements }));
    video.distinctList = distinct.map((d) => ({ sha256: d.sha256, bytes: d.bytes, basenames: [...d.basenames], placements: d.placements }));
  }

  return {
    slides: slideCensuses.length,
    scenes,
    assets: { ...assetCensus, distinctSizes: assetCensus.distinctSizes.size },
    effects: {
      topLevel: { transition: sortedCounts(topLevel.transition), buildIn: sortedCounts(topLevel.buildIn), other: sortedCounts(topLevel.other) },
      recursive: sortedCounts(recursive),
      pushDirections: sortedCounts(pushDirections),
    },
    textureType: sortedCounts(textureType),
    isBackgroundTexture: sortedCounts(isBackgroundTexture),
    layerState,
    video,
    perSlide: slideCensuses.map((s) => ({
      index: s.index,
      uuid: s.uuid,
      scenes: s.scenes,
      textures: s.textures,
      videos: s.videos,
      transition: s.transition,
      topLevelBuildNames: s.topLevelBuildNames,
    })),
  };
}

/** Fetch every GIF placement through the cache. Returns map "uuid/url" -> { sha256, bytes, file }. */
export async function fetchGifs(base, slideCensuses, opts) {
  const out = {};
  for (const s of slideCensuses) {
    for (const p of s.moviePlacements) {
      const key = `${s.uuid}/${p.url}`;
      if (out[key]) continue;
      const { bytes, file } = await fetchAsset(base, s.uuid, p.url, opts);
      out[key] = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, file };
    }
  }
  return out;
}

function mdTable(headers, rows) {
  const line = (cells) => `| ${cells.map((c) => String(c).replace(/\|/g, '\\|')).join(' | ')} |`;
  return [line(headers), `|${headers.map(() => '---').join('|')}|`, ...rows.map(line)].join('\n');
}

function countTable(map, keyHeader, valueHeader = 'count') {
  return mdTable([keyHeader, valueHeader], Object.entries(map).map(([k, v]) => [`\`${k}\``, v]));
}

/** Render the deck census as markdown sections. */
export function renderMarkdown(c) {
  const out = [];
  out.push('### Per-slide layout\n');
  out.push(
    mdTable(
      ['#', 'UUID', 'scenes', 'textures', 'videos', 'transition', 'direction', 'top-level builds'],
      c.perSlide.map((s) => [
        s.index,
        `\`${s.uuid.slice(0, 8)}\``,
        s.scenes,
        s.textures,
        s.videos,
        `\`${s.transition.name}\``,
        s.transition.direction,
        s.topLevelBuildNames.length ? s.topLevelBuildNames.map((n) => `\`${n}\``).join(', ') : '(none)',
      ]),
    ),
  );
  out.push(`\nTotals: ${c.slides} slides, ${c.scenes} scenes, ${c.assets.textures} textures, ${c.assets.videos} videos.\n`);

  out.push('### Asset census\n');
  out.push(countTable(c.assets.types, 'type'));
  out.push('');
  out.push(countTable(c.assets.extensions, 'extension'));
  out.push(`\nDistinct sizes: ${c.assets.distinctSizes}. Textures at 1920x1080: ${c.assets.full1920x1080} of ${c.assets.textures}.\n`);

  out.push('### Effect census, top-level `events[].effects[]`\n');
  out.push(countTable(c.effects.topLevel.transition, 'transition'));
  out.push('');
  out.push(countTable(c.effects.topLevel.buildIn, 'buildIn'));
  if (Object.keys(c.effects.topLevel.other).length) {
    out.push('');
    out.push(countTable(c.effects.topLevel.other, 'other'));
  }
  out.push('\n### Effect census, recursive `effects[].effects[]`\n');
  out.push(countTable(c.effects.recursive, 'name'));
  out.push('\n### Push `attributes.direction`\n');
  out.push(countTable(c.effects.pushDirections, 'direction', 'slides'));

  out.push('\n### `textureType` and `isBackgroundTexture` (every texturedRectangle leaf, every baseLayer, every depth)\n');
  out.push(countTable(c.textureType, 'textureType'));
  out.push('');
  out.push(countTable(c.isBackgroundTexture, 'isBackgroundTexture'));
  out.push('\n### Layer state\n');
  const ls = c.layerState;
  out.push(
    mdTable(
      ['field', 'count'],
      [
        ['layers, all baseLayers, all depths', ls.layers],
        ['layers under `events[].baseLayer` only', ls.layersInEventBaseLayers],
        ['texturedRectangle leaves, all baseLayers', ls.textureLeaves],
        ['texturedRectangle leaves under `events[].baseLayer` only', ls.textureLeavesInEventBaseLayers],
        ['hidden texturedRectangle leaves, all baseLayers', ls.hiddenTextureLeaves],
        ['hidden texturedRectangle leaves under `events[].baseLayer` only', ls.hiddenTextureLeavesInEventBaseLayers],
        ['`isVideoLayer` layers', ls.videoLayers],
        ['`opacity` below 1, all baseLayers', ls.opacityBelowOne],
        ['`opacity` below 1 under `events[].baseLayer` only', ls.opacityBelowOneInEventBaseLayers],
        ['`sublayerTransform` identity, all baseLayers', ls.sublayerIdentity],
        ['`sublayerTransform` with one perspective term (m34), all baseLayers', ls.sublayerPerspective],
        ['`sublayerTransform` with one perspective term under `events[].baseLayer` only', ls.sublayerPerspectiveInEventBaseLayers],
        ['`sublayerTransform` other', ls.sublayerOther],
        ['`masksToBounds` true', ls.masksToBoundsTrue],
        ['`edgeAntialiasingMask` values', Object.entries(ls.edgeAntialiasingMask).map(([k, v]) => `${k}: ${v}`).join(', ')],
        ['`shapePath.elements` carriers / entries', `${ls.shapePathCarriers} / ${ls.shapePathElements}`],
        ['`repGenerationDictionary.infoShapePath` carriers / entries', `${ls.infoShapePathCarriers} / ${ls.infoShapePathElements}`],
        ['`textColor` carriers', ls.textColor],
      ],
    ),
  );

  out.push('\n### Video census\n');
  const v = c.video;
  const rows = [
    ['placements (`renderMovie` effects with `movie`)', v.placements],
    ['slides with video', v.slidesWithVideo],
    ['max placements per slide', v.maxPerSlide],
    ['distinct basenames', v.distinctBasenames],
    ['distinct URL paths', v.distinctUrlPaths],
    ['widest placement (px)', v.maxWidth],
  ];
  if (v.distinctBySha256 !== undefined) {
    rows.push(['distinct by sha256 of bytes', v.distinctBySha256]);
    rows.push(['bytes, distinct GIFs', v.distinctBytes]);
    rows.push(['bytes, all placements', v.placementBytes]);
  }
  out.push(mdTable(['field', 'value'], rows));
  if (v.largest) {
    out.push('\nLargest distinct GIFs:\n');
    out.push(mdTable(['sha256-12', 'bytes', 'placements', 'basenames'], v.largest.map((d) => [`\`${d.sha256.slice(0, 12)}\``, d.bytes, d.placements, d.basenames.map((b) => `\`${b}\``).join(', ')])));
  }
  return out.join('\n') + '\n';
}

function parseArgs(argv) {
  const o = { kpf: LIVE_BASE, json: null, md: null, gifs: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--kpf') o.kpf = argv[++i];
    else if (a === '--json') o.json = argv[++i];
    else if (a === '--md') o.md = argv[++i];
    else if (a === '--no-gifs') o.gifs = false;
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

export async function main(argv) {
  const o = parseArgs(argv);
  const header = await loadHeader(o.kpf);
  const per = [];
  let i = 0;
  for (const uuid of header.slideList) {
    i += 1;
    per.push(censusSlide(i, uuid, await loadSlide(o.kpf, uuid)));
  }
  const gifs = o.gifs ? await fetchGifs(o.kpf, per) : null;
  const deck = censusDeck(per, gifs);
  deck.header = { slideCount: header.slideCount, slideWidth: header.slideWidth, slideHeight: header.slideHeight, fonts: header.fonts.length, creator: header.creator, title: header.title };
  if (o.json) writeFileSync(o.json, JSON.stringify(deck, null, 2) + '\n');
  if (o.md) writeFileSync(o.md, renderMarkdown(deck));
  if (!o.json && !o.md) process.stdout.write(JSON.stringify(deck, null, 2) + '\n');
  else console.log(`census: ${deck.slides} slides, ${deck.assets.textures} textures, ${deck.assets.videos} videos, ${deck.video.placements} placements${gifs ? `, ${deck.video.distinctBySha256} distinct GIFs, ${deck.video.distinctBytes} bytes` : ''}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.error(err); process.exit(1); });
}
