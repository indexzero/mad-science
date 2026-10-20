import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { buildManifest, collectFiles } from "../skill/save-it/scripts/bundle.mjs";

const TMP = fileURLToPath(new URL("../.tmp/", import.meta.url));
const BUNDLE = fileURLToPath(new URL("../skill/save-it/scripts/bundle.mjs", import.meta.url));
const META = { date: "2026-09-26", source: "claude-mobile", topic: "3coin-in-3d" };
const FILES = [
  { path: "outputs/z.md", data: Buffer.from("zz"), origin: "output" },
  { path: "TRANSCRIPT.md", data: Buffer.from("t"), origin: "transcript" },
  { path: "inputs/a.pdf", data: Buffer.from("abc"), origin: "input" }
];

/**
 * @param {Uint8Array} data
 * @returns {string}
 */
function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Reads every entry of a USTAR archive: the UTF-8 name and the data bytes.
 * @param {Buffer} tar
 * @returns {Map<string, Buffer>}
 */
function readTar(tar) {
  const out = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length && tar[offset] !== 0) {
    const raw = tar.subarray(offset, offset + 100);
    const end = raw.indexOf(0);
    const name = raw.subarray(0, end === -1 ? 100 : end).toString("utf8");
    const size = parseInt(tar.subarray(offset + 124, offset + 135).toString("latin1"), 8);
    out.set(name, Buffer.from(tar.subarray(offset + 512, offset + 512 + size)));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

/**
 * A preload for the bundle CLI. It maps the fixed sandbox paths into the
 * directory in SAVE_IT_TEST_ROOT. The script itself stays unchanged.
 */
const PRELOAD = `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const root = process.env.SAVE_IT_TEST_ROOT;
const map = (p) => typeof p !== "string" ? p : p
  .replace(/^\\/mnt\\/user-data\\/uploads(?=\\/|$)/, root + "/uploads")
  .replace(/^\\/mnt\\/user-data\\/outputs(?=\\/|$)/, root + "/outputs")
  .replace(/^\\/tmp\\/save-it(?=\\/|$)/, root + "/saved");
for (const name of ["readFileSync", "writeFileSync", "mkdirSync", "readdirSync"]) {
  const original = fs[name];
  fs[name] = (p, ...rest) => original(map(p), ...rest);
}
syncBuiltinESMExports();
`;

test("buildManifest records path, sha256, size, origin for each file", () => {
  const manifest = buildManifest(FILES, META);
  assert.equal(manifest.files.length, 3);
  for (const file of FILES) {
    const item = manifest.files.find((entry) => entry.path === file.path);
    assert.deepEqual(item, {
      path: file.path,
      sha256: sha256(file.data),
      size: file.data.length,
      origin: file.origin
    });
  }
  assert.equal(manifest.files.some((entry) => entry.path === "manifest.json"), false);
});

test("the manifest carries date, source, topic, and transcript: reconstructed", () => {
  const manifest = buildManifest(FILES, META);
  assert.deepEqual(Object.keys(manifest), ["date", "source", "topic", "transcript", "files"]);
  assert.equal(manifest.date, "2026-09-26");
  assert.equal(manifest.source, "claude-mobile");
  assert.equal(manifest.topic, "3coin-in-3d");
  assert.equal(manifest.transcript, "reconstructed");
});

test("files are sorted by path", () => {
  const manifest = buildManifest(FILES, META);
  assert.deepEqual(
    manifest.files.map((entry) => entry.path),
    ["TRANSCRIPT.md", "inputs/a.pdf", "outputs/z.md"]
  );
});

test("collectFiles skips a symbolic link and keeps relative paths", () => {
  mkdirSync(TMP, { recursive: true });
  const dir = mkdtempSync(join(TMP, "manifest-"));
  try {
    mkdirSync(join(dir, "sub", "deep"), { recursive: true });
    writeFileSync(join(dir, "a.txt"), "a");
    writeFileSync(join(dir, "sub", "deep", "b.txt"), "bb");
    symlinkSync("a.txt", join(dir, "link.txt"));
    symlinkSync("sub", join(dir, "linkdir"));
    const files = collectFiles(dir, "input");
    assert.deepEqual(files.map((file) => file.path).sort(), ["inputs/a.txt", "inputs/sub/deep/b.txt"]);
    assert.ok(files.every((file) => file.origin === "input"));
    const outputs = collectFiles(dir, "output");
    assert.deepEqual(outputs.map((file) => file.path).sort(), ["outputs/a.txt", "outputs/sub/deep/b.txt"]);
    assert.ok(outputs.every((file) => file.origin === "output"));
    assert.deepEqual(collectFiles(join(dir, "missing"), "input"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a full bundle run archives every source byte and each manifest origin", () => {
  mkdirSync(TMP, { recursive: true });
  const dir = mkdtempSync(join(TMP, "bundle-"));
  try {
    const binary = Buffer.alloc(1300);
    for (let i = 0; i < binary.length; i++) binary[i] = (i * 31 + 7) % 256;
    /** @type {Record<string, { data: Buffer, origin: string }>} */
    const expected = {
      "inputs/a.pdf": { data: binary, origin: "input" },
      "inputs/sub/b.txt": { data: Buffer.from("input b"), origin: "input" },
      "outputs/z.md": { data: Buffer.from("# output z"), origin: "output" },
      "outputs/deep/img.bin": { data: Buffer.from([0, 1, 2, 0xfe, 0xff]), origin: "output" },
      "TRANSCRIPT.md": { data: Buffer.from("This transcript was reconstructed by Claude."), origin: "transcript" }
    };
    for (const [path, { data }] of Object.entries(expected)) {
      const real = path === "TRANSCRIPT.md" ? join(dir, "TRANSCRIPT.md") : join(dir, path.replace(/^inputs\//, "uploads/"));
      mkdirSync(join(real, ".."), { recursive: true });
      writeFileSync(real, data);
    }
    const preload = join(dir, "preload.mjs");
    writeFileSync(preload, PRELOAD);
    const stdout = execFileSync(
      process.execPath,
      ["--import", pathToFileURL(preload).href, BUNDLE,
        "--date", META.date, "--source", META.source, "--topic", META.topic,
        "--transcript", join(dir, "TRANSCRIPT.md")],
      { encoding: "utf8", env: { ...process.env, SAVE_IT_TEST_ROOT: dir } }
    );
    const line = JSON.parse(stdout);
    assert.equal(line.path, `/tmp/save-it/${META.date}-${META.source}-${META.topic}.tgz`);
    const gz = readFileSync(join(dir, "saved", line.path.slice("/tmp/save-it/".length)));
    assert.equal(line.sha256, sha256(gz));
    assert.equal(line.size, gz.length);

    const archive = readTar(gunzipSync(gz));
    assert.deepEqual([...archive.keys()].sort(), [...Object.keys(expected), "manifest.json"].sort());
    for (const [path, { data }] of Object.entries(expected)) {
      assert.deepEqual(archive.get(path), data, `bytes of ${path}`);
    }
    const manifest = JSON.parse(archive.get("manifest.json").toString("utf8"));
    assert.deepEqual(
      [...manifest.files].sort((a, b) => a.path.localeCompare(b.path)),
      Object.entries(expected)
        .map(([path, { data, origin }]) => ({ path, sha256: sha256(data), size: data.length, origin }))
        .sort((a, b) => a.path.localeCompare(b.path))
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
