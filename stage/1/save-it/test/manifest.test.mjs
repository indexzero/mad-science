import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildManifest, collectFiles } from "../skill/save-it/scripts/bundle.mjs";

const TMP = fileURLToPath(new URL("../.tmp/", import.meta.url));
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
    assert.deepEqual(
      collectFiles(dir, "output").map((file) => file.path).sort(),
      ["outputs/a.txt", "outputs/sub/deep/b.txt"]
    );
    assert.deepEqual(collectFiles(join(dir, "missing"), "input"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
