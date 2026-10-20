// Media wrappers: embedded image streams through `mutool extract`, 1x rasters through `pdftocairo`,
// GIF to MP4 and WebM through `ffmpeg`, with byte accounting and sha256 naming.
// Tools come from the environment (MUTOOL, PDFTOCAIRO, FFMPEG) so a unit test can stub them.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';

export const MUTOOL = process.env.MUTOOL || 'mutool';
export const PDFTOCAIRO = process.env.PDFTOCAIRO || 'pdftocairo';
export const FFMPEG = process.env.FFMPEG || 'ffmpeg';

export const FONT_EXT_RE = /\.(ttf|otf|cff|woff2?|pfb|pfa)$/i;

export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}

/** Delete every font file a tool wrote under `dir`. Returns the count. */
export function deleteFontFiles(dir) {
  let n = 0;
  for (const name of readdirSync(dir)) {
    if (FONT_EXT_RE.test(name)) {
      unlinkSync(join(dir, name));
      n += 1;
    }
  }
  return n;
}

/** Width and height of a PNG or JPEG buffer, or null. */
export function imageSize(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let p = 2;
    while (p + 9 < buf.length) {
      if (buf[p] !== 0xff) { p += 1; continue; }
      const marker = buf[p + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
      const len = buf.readUInt16BE(p + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(p + 5), width: buf.readUInt16BE(p + 7) };
      }
      p += 2 + len;
    }
  }
  return null;
}

/** Object numbers of the image XObjects of page `pageIndex` (0-based), through `mutool show`. */
export function pageImageObjects(pdfPath, pageIndex) {
  const out = run(MUTOOL, ['show', pdfPath, `pages/${pageIndex + 1}/Resources/XObject`]);
  return [...out.matchAll(/(\d+)\s+0\s+R/g)].map((m) => Number(m[1]));
}

/**
 * Extract every image stream of a page into `scratchDir` with `mutool extract -a` (SMask folded in as
 * alpha), then delete every font file written there. Returns { images: [{ object, file, ext, width,
 * height, bytes }], fontFilesDeleted }. The caller copies what it needs and removes the scratch.
 */
export function extractPageImages(pdfPath, pageIndex, scratchDir) {
  const objects = pageImageObjects(pdfPath, pageIndex);
  rmSync(scratchDir, { recursive: true, force: true });
  mkdirSync(scratchDir, { recursive: true });
  if (!objects.length) return { images: [], fontFilesDeleted: 0 };
  run(MUTOOL, ['extract', '-a', pdfPath, ...objects.map(String)], { cwd: scratchDir });
  const fontFilesDeleted = deleteFontFiles(scratchDir);
  const images = [];
  for (const f of readdirSync(scratchDir)) {
    const m = /^image-(\d+)\.(png|jpg|jpeg)$/i.exec(f);
    if (!m) continue;
    const file = join(scratchDir, f);
    const buf = readFileSync(file);
    const size = imageSize(buf);
    images.push({ object: Number(m[1]), file, ext: /^png$/i.test(m[2]) ? 'png' : 'jpg', width: size?.width ?? null, height: size?.height ?? null, bytes: buf.length });
  }
  images.sort((a, b) => a.object - b.object);
  return { images, fontFilesDeleted };
}

/** Copy an extracted image to `outDir/<name>.<ext>`. Returns the destination path. */
export function placeImage(img, outDir, name) {
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${name}.${img.ext}`);
  copyFileSync(img.file, file);
  return file;
}

/**
 * Extract the one embedded image stream of a picture page to `outDir/<name>.<png|jpg>`. Returns
 * { file, ext, width, height, bytes, fontFilesDeleted, object } or null when the page has no single image.
 */
export function extractImage(pdfPath, pageIndex, outDir, name, { scratchDir } = {}) {
  const scratch = scratchDir || join(outDir, '.extract');
  const { images, fontFilesDeleted } = extractPageImages(pdfPath, pageIndex, scratch);
  let out = null;
  if (images.length === 1) {
    const img = images[0];
    out = { file: placeImage(img, outDir, name), ext: img.ext, width: img.width, height: img.height, bytes: img.bytes, fontFilesDeleted, object: img.object };
  }
  rmSync(scratch, { recursive: true, force: true });
  return out;
}

/**
 * 1x raster of one page: `pdftocairo -png -r 72 -transp -singlefile -f n -l n in.pdf out`.
 * `-transp` keeps the page background transparent (the design's command would paint it white, which
 * destroys overlay pages such as a 70 percent black rectangle). Returns { file, width, height, bytes }.
 */
export function rasterize(pdfPath, pageIndex, outPathPng) {
  const prefix = outPathPng.replace(/\.png$/i, '');
  mkdirSync(join(prefix, '..'), { recursive: true });
  run(PDFTOCAIRO, ['-png', '-r', '72', '-transp', '-singlefile', '-f', String(pageIndex + 1), '-l', String(pageIndex + 1), pdfPath, prefix]);
  const file = `${prefix}.png`;
  const buf = readFileSync(file);
  const size = imageSize(buf);
  return { file, width: size?.width ?? null, height: size?.height ?? null, bytes: buf.length };
}

/** True when any pixel of the first GIF frame has alpha below 255. */
export function gifHasAlpha(gifPath) {
  const raw = execFileSync(FFMPEG, ['-nostdin', '-v', 'error', '-i', gifPath, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
  for (let i = 3; i < raw.length; i += 4) if (raw[i] < 255) return true;
  return false;
}

export const SCALE_EVEN = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

/**
 * Transcode a GIF to `outDir/<sha256-12>.{mp4,webm,png}` with the design's commands (plus `-nostdin`).
 * Deduplicates by sha256 of the GIF bytes: existing outputs are reused. Returns
 * { sha12, mp4, webm, poster, originalBytes, bytes: { mp4, webm, poster }, transparent, reused }.
 */
export function transcodeGif(gifPath, outDir) {
  const gif = readFileSync(gifPath);
  const sha12 = sha256Hex(gif).slice(0, 12);
  mkdirSync(outDir, { recursive: true });
  const mp4 = join(outDir, `${sha12}.mp4`);
  const webm = join(outDir, `${sha12}.webm`);
  const poster = join(outDir, `${sha12}.png`);
  const reused = existsSync(mp4) && existsSync(webm) && existsSync(poster);
  let transparent = false;
  if (!reused) {
    transparent = gifHasAlpha(gifPath);
    run(FFMPEG, ['-nostdin', '-v', 'error', '-y', '-i', gifPath, '-movflags', 'faststart', '-vf', SCALE_EVEN, '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-crf', '23', '-an', mp4]);
    run(FFMPEG, ['-nostdin', '-v', 'error', '-y', '-i', gifPath, '-vf', SCALE_EVEN, '-pix_fmt', transparent ? 'yuva420p' : 'yuv420p', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '32', '-an', webm]);
    run(FFMPEG, ['-nostdin', '-v', 'error', '-y', '-i', gifPath, '-frames:v', '1', poster]);
  }
  return {
    sha12,
    mp4,
    webm,
    poster,
    originalBytes: gif.length,
    bytes: { mp4: statSync(mp4).size, webm: statSync(webm).size, poster: statSync(poster).size },
    transparent,
    reused,
    basename: basename(gifPath),
  };
}
