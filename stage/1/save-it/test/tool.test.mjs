// Unit tests for the MCP tool. They call mintUploadUrl directly with a stub auth context.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mintUploadUrl } from "../src/tool.mjs";
import { verify } from "../src/token.mjs";

const SECRET = "test-signing-key-32-bytes-long-0";
const EMAIL = "owner@example.com";
const ORIGIN = "http://localhost";
const NOW = new Date("2026-09-26T12:00:00Z");

const ENV = {
  ALLOWED_EMAIL: EMAIL,
  UPLOAD_SIGNING_KEY: SECRET,
  MAX_BYTES: "52428800",
  UPLOAD_TTL_SECONDS: "60"
};

const VECTOR = {
  date: "2026-09-26",
  source: "claude-mobile",
  topic: "3coin-in-3d",
  sha256: "a9b7df43aa05a12f3f7c4265fd61a8d50029c3a2a28a12f231bad480747cc8ab",
  size: 480981
};

const KEY = "2026-09-26-claude-mobile-3coin-in-3d-a9b7df43aa05a12f3f7c4265fd61a8d50029c3a2a28a12f231bad480747cc8ab.tgz";

/**
 * Calls mintUploadUrl with the test defaults.
 * @param {unknown} args
 * @param {{ env?: object, email?: string, props?: Record<string, unknown> }} [overrides]
 */
function mint(args, { env = ENV, email = EMAIL, props = { email } } = {}) {
  return mintUploadUrl(args, { env, origin: ORIGIN, now: NOW, authContext: { props } });
}

test("mintUploadUrl returns key, url, expires_at for the [25] vector", async () => {
  const result = await mint(VECTOR);
  assert.equal(result.isError, undefined);
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  const body = JSON.parse(result.content[0].text);
  assert.deepEqual(Object.keys(body), ["key", "url", "expires_at"]);
  assert.equal(body.key, KEY);
  assert.equal(body.expires_at, "2026-09-26T12:01:00.000Z");
});

test("mintUploadUrl names the field for each invalid argument", async () => {
  const cases = [
    ["date", { ...VECTOR, date: "2026-02-30" }],
    ["source", { ...VECTOR, source: "claude-desktop" }],
    ["topic", { ...VECTOR, topic: "Bad-Topic" }],
    ["sha256", { ...VECTOR, sha256: VECTOR.sha256.toUpperCase() }],
    ["size", { ...VECTOR, size: 0 }]
  ];
  for (const [field, args] of cases) {
    const result = await mint(args);
    assert.equal(result.isError, true, field);
    assert.ok(
      result.content[0].text.startsWith(`not valid: ${field}:`),
      `${field}: ${result.content[0].text}`
    );
  }
});

test("mintUploadUrl refuses a different email", async () => {
  const result = await mint(VECTOR, { email: "other@example.com" });
  assert.equal(result.isError, true);
  assert.equal(
    result.content[0].text,
    "not saved: this token is not for the allowed email. fix: add the connector again"
  );
});

test("mintUploadUrl mints when ALLOWED_EMAIL has a trailing space", async () => {
  const result = await mint(VECTOR, { env: { ...ENV, ALLOWED_EMAIL: `${EMAIL} ` } });
  assert.equal(result.isError, undefined, result.content[0].text);
  assert.equal(JSON.parse(result.content[0].text).key, KEY);
});

test("mintUploadUrl refuses when UPLOAD_SIGNING_KEY is missing or shorter than 32 bytes", async () => {
  const missing = { ...ENV };
  delete missing.UPLOAD_SIGNING_KEY;
  const short = { ...ENV, UPLOAD_SIGNING_KEY: "x".repeat(31) };
  for (const env of [missing, short]) {
    const result = await mint(VECTOR, { env });
    assert.equal(result.isError, true);
    assert.equal(
      result.content[0].text,
      "not saved: the Worker has no signing key. fix: run SETUP.md step 3"
    );
  }
});

test("the url is origin + /u/ + token and the token verifies", async () => {
  const result = await mint(VECTOR);
  const body = JSON.parse(result.content[0].text);
  const prefix = `${ORIGIN}/u/`;
  assert.ok(body.url.startsWith(prefix), body.url);
  const token = body.url.slice(prefix.length);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const verified = await verify(token, SECRET, NOW);
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.payload, {
    key: KEY,
    sha256: VECTOR.sha256,
    size: VECTOR.size,
    exp: Date.parse(body.expires_at) / 1000
  });
});
