import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Stub tools live under .cache/test (gitignored). The env must be set before media.js loads.
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '.cache', 'test', `media-${process.pid}`);
const bin = join(root, 'bin');
rmSync(root, { recursive: true, force: true });
mkdirSync(bin, { recursive: true });

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const png = PNG_1X1.toString('base64');

function stub(name, body) {
  const file = join(bin, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

// mutool: `show pdf pages/N/Resources/XObject` prints one image object; `extract -a pdf N` writes an image and a font.
stub('mutool', `
if [ "$1" = "show" ]; then echo "<<"; echo "  /Im1 10 0 R"; echo ">>"; exit 0; fi
if [ "$1" = "extract" ]; then echo "${png}" | base64 -d > image-0010.png; echo "font" > font-0077.ttf; echo "font" > font-0079.cff; exit 0; fi
exit 1`);
// pdftocairo: writes <prefix>.png
stub('pdftocairo', `
for last; do :; done
echo "${png}" | base64 -d > "$last.png"`);
// ffmpeg: rawvideo probe prints four opaque bytes; otherwise writes the output path with the codec name as content
stub('ffmpeg', `
for last; do :; done
if [ "$last" = "-" ]; then printf '\\377\\377\\377\\377'; exit 0; fi
echo "$@" > "$last"`);

process.env.MUTOOL = join(bin, 'mutool');
process.env.PDFTOCAIRO = join(bin, 'pdftocairo');
process.env.FFMPEG = join(bin, 'ffmpeg');
const media = await import('../media.js');

test('sha256 naming: a GIF transcodes to media/shared/<sha256-12>.{mp4,webm,png} and a second call reuses it', () => {
  const gif = join(root, 'a b (c).gif');
  writeFileSync(gif, Buffer.from('GIF89a-not-really'));
  const sha12 = media.sha256Hex(readFileSync(gif)).slice(0, 12);
  const out = join(root, 'shared');
  const r = media.transcodeGif(gif, out);
  assert.equal(r.sha12, sha12);
  assert.equal(r.mp4, join(out, `${sha12}.mp4`));
  assert.equal(r.webm, join(out, `${sha12}.webm`));
  assert.equal(r.poster, join(out, `${sha12}.png`));
  assert.equal(r.reused, false);
  assert.equal(r.transparent, false);
  assert.equal(r.originalBytes, 17);
  assert.match(readFileSync(r.mp4, 'utf8'), /libx264 -crf 23 -an/);
  assert.match(readFileSync(r.webm, 'utf8'), /-pix_fmt yuv420p -c:v libvpx-vp9 -b:v 0 -crf 32/);
  assert.match(readFileSync(r.poster, 'utf8'), /-frames:v 1/);
  assert.ok(r.bytes.mp4 > 0 && r.bytes.webm > 0 && r.bytes.poster > 0);
  const again = media.transcodeGif(gif, out);
  assert.equal(again.reused, true);
  assert.equal(again.sha12, sha12);
  assert.ok(!/[ ()]/.test(r.mp4.slice(out.length)));
});

test('extractImage deletes the font files mutool writes and copies the one image', () => {
  const outDir = join(root, 'slide');
  const r = media.extractImage(join(root, 'fake.pdf'), 1, outDir, 'ASSET', { scratchDir: join(root, 'scratch') });
  assert.equal(r.object, 10);
  assert.equal(r.ext, 'png');
  assert.equal(r.fontFilesDeleted, 2);
  assert.equal(r.width, 1);
  assert.equal(r.height, 1);
  assert.equal(r.file, join(outDir, 'ASSET.png'));
  assert.ok(existsSync(r.file));
  assert.equal(existsSync(join(root, 'scratch')), false, 'scratch is removed');
  const fonts = readdirSync(root, { recursive: true }).filter((f) => media.FONT_EXT_RE.test(String(f)));
  assert.deepEqual(fonts, []);
});

test('rasterize writes a 1x PNG with a transparent background flag', () => {
  const r = media.rasterize(join(root, 'fake.pdf'), 0, join(root, 'raster', 'P.png'));
  assert.equal(r.file, join(root, 'raster', 'P.png'));
  assert.equal(r.width, 1);
  assert.equal(r.bytes, PNG_1X1.length);
});

test('imageSize reads PNG and JPEG headers', () => {
  assert.deepEqual(media.imageSize(PNG_1X1), { width: 1, height: 1 });
  // a minimal JPEG SOF0 header: FFD8, then FFC0 with length 17, precision 8, height 435, width 652
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xb3, 0x02, 0x8c, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(media.imageSize(jpg), { width: 652, height: 435 });
  assert.equal(media.imageSize(Buffer.from('nope')), null);
});

test.after(() => rmSync(root, { recursive: true, force: true }));
