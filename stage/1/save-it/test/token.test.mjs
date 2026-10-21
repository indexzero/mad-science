import { test } from "node:test";
import assert from "node:assert/strict";
import { sign, verify, base64urlEncode, base64urlDecode } from "../src/token.mjs";

const SECRET = "test-signing-key-32-bytes-long-0";
const NOW = new Date("2026-09-26T12:00:00Z");
const INPUT = {
  key: "2026-09-26-claude-mobile-3coin-in-3d-a9b7df43aa05a12f3f7c4265fd61a8d50029c3a2a28a12f231bad480747cc8ab.tgz",
  sha256: "a9b7df43aa05a12f3f7c4265fd61a8d50029c3a2a28a12f231bad480747cc8ab",
  size: 480981,
  ttlSeconds: 60
};
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Changes one byte of a token part and encodes the part again.
 * @param {string} part
 * @param {number} index
 * @returns {string}
 */
function flipByte(part, index) {
  const bytes = base64urlDecode(part);
  assert.ok(bytes);
  bytes[index] ^= 0x01;
  return base64urlEncode(bytes);
}

test("sign then verify returns the payload", async () => {
  const { token, exp } = await sign(INPUT, SECRET, NOW);
  assert.equal(exp, Math.floor(NOW.getTime() / 1000) + 60);
  const result = await verify(token, SECRET, NOW);
  assert.deepEqual(result, {
    ok: true,
    payload: { key: INPUT.key, sha256: INPUT.sha256, size: INPUT.size, exp }
  });
});

test("the token has two base64url parts and no padding", async () => {
  const { token } = await sign(INPUT, SECRET, NOW);
  const parts = token.split(".");
  assert.equal(parts.length, 2);
  for (const part of parts) assert.match(part, /^[A-Za-z0-9_-]+$/);
  assert.ok(!token.includes("="));
});

test("a tampered payload byte fails with bad-signature", async () => {
  const { token } = await sign(INPUT, SECRET, NOW);
  const [payload, signature] = token.split(".");
  const tampered = `${flipByte(payload, 10)}.${signature}`;
  assert.deepEqual(await verify(tampered, SECRET, NOW), { ok: false, kind: "bad-signature" });
});

test("a tampered signature fails with bad-signature", async () => {
  const { token } = await sign(INPUT, SECRET, NOW);
  const [payload, signature] = token.split(".");
  const tampered = `${payload}.${flipByte(signature, 0)}`;
  assert.deepEqual(await verify(tampered, SECRET, NOW), { ok: false, kind: "bad-signature" });
});

test("a part that does not round-trip fails with malformed", async () => {
  const { token } = await sign(INPUT, SECRET, NOW);
  const [payload, signature] = token.split(".");
  // 32 bytes encode to 43 characters. The last character carries 2 unused bits.
  const last = signature.at(-1);
  const changed = ALPHABET[ALPHABET.indexOf(last) ^ 0x01];
  const altered = signature.slice(0, -1) + changed;
  assert.deepEqual(base64urlDecode(altered), base64urlDecode(signature));
  assert.deepEqual(await verify(`${payload}.${altered}`, SECRET, NOW), {
    ok: false,
    kind: "malformed"
  });
});

test("an expired token fails with expired", async () => {
  const { token, exp } = await sign(INPUT, SECRET, NOW);
  assert.equal((await verify(token, SECRET, new Date(exp * 1000))).ok, true);
  const later = new Date((exp + 1) * 1000);
  assert.deepEqual(await verify(token, SECRET, later), { ok: false, kind: "expired" });
});

test("a wrong secret fails with bad-signature", async () => {
  const { token } = await sign(INPUT, SECRET, NOW);
  assert.deepEqual(await verify(token, "another-signing-key-32-bytes-000", NOW), {
    ok: false,
    kind: "bad-signature"
  });
});

test("a token with one part fails with malformed", async () => {
  const { token } = await sign(INPUT, SECRET, NOW);
  assert.deepEqual(await verify(token.split(".")[0], SECRET, NOW), {
    ok: false,
    kind: "malformed"
  });
  assert.deepEqual(await verify(`${token}.AA`, SECRET, NOW), { ok: false, kind: "malformed" });
});

/**
 * Signs arbitrary payload text with the right secret.
 * @param {string} text
 * @returns {Promise<string>}
 */
async function signText(text) {
  const payloadBytes = new TextEncoder().encode(text);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, payloadBytes));
  return `${base64urlEncode(payloadBytes)}.${base64urlEncode(hmac)}`;
}

test("a payload that is not JSON fails with malformed", async () => {
  const token = await signText("not json");
  assert.deepEqual(await verify(token, SECRET, NOW), { ok: false, kind: "malformed" });
});

test("an expired token with a wrong secret fails with bad-signature", async () => {
  const { token, exp } = await sign(INPUT, "another-signing-key-32-bytes-000", NOW);
  const later = new Date((exp + 1) * 1000);
  assert.deepEqual(await verify(token, SECRET, later), { ok: false, kind: "bad-signature" });
});

test("a signed payload with a missing or wrongly typed field fails with malformed", async () => {
  const exp = Math.floor(NOW.getTime() / 1000) + 60;
  const good = { key: INPUT.key, sha256: INPUT.sha256, size: INPUT.size, exp };
  const { key, ...noKey } = good;
  const { sha256, ...noSha256 } = good;
  const { size, ...noSize } = good;
  const { exp: _exp, ...noExp } = good;
  const cases = [
    ["no key", noKey],
    ["no sha256", noSha256],
    ["no size", noSize],
    ["no exp", noExp],
    ["key is a number", { ...good, key: 1 }],
    ["sha256 is null", { ...good, sha256: null }],
    ["size is a string", { ...good, size: String(size) }],
    ["size is a float", { ...good, size: 1.5 }],
    ["exp is a string", { ...good, exp: String(exp) }],
    ["null", null],
    ["an array", [key, sha256, size, exp]],
    ["a string", "payload"]
  ];
  assert.equal((await verify(await signText(JSON.stringify(good)), SECRET, NOW)).ok, true);
  for (const [label, value] of cases) {
    const token = await signText(JSON.stringify(value));
    assert.deepEqual(await verify(token, SECRET, NOW), { ok: false, kind: "malformed" }, label);
  }
});
