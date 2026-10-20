// Integration tests for the Worker. Miniflare boots the dry-run bundle.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { sign, base64urlEncode, base64urlDecode } from "../src/token.mjs";

const BUNDLE = new URL("../dist/worker/worker.js", import.meta.url).pathname;
const SECRET = "test-signing-key-32-bytes-long-0";
const BODY = "hello save-it";
const SHA256 = createHash("sha256").update(BODY).digest("hex");
const SIZE = Buffer.byteLength(BODY);

/**
 * Makes the Miniflare options with the design bindings.
 * @param {Record<string, string>} [overrides]
 */
function options(overrides = {}) {
  return {
    modules: true,
    scriptPath: BUNDLE,
    compatibilityDate: "2026-07-30",
    compatibilityFlags: ["nodejs_compat"],
    r2Buckets: ["BUNDLES"],
    kvNamespaces: ["OAUTH_KV"],
    bindings: {
      ALLOWED_EMAIL: "owner@example.com",
      UPLOAD_SIGNING_KEY: SECRET,
      MAX_BYTES: "52428800",
      UPLOAD_TTL_SECONDS: "60",
      ...overrides
    }
  };
}

/** @type {Miniflare} */
let mf;

before(async () => {
  assert.ok(existsSync(BUNDLE), `the dry-run bundle is missing: ${BUNDLE}. Run pnpm test.`);
  mf = new Miniflare(options());
  await mf.ready;
});

after(async () => {
  await mf.dispose();
});

/**
 * Makes the key for a topic. Each test uses its own topic.
 * @param {string} topic
 * @param {string} [sha256]
 */
function keyFor(topic, sha256 = SHA256) {
  return `2026-10-20-claude-web-${topic}-${sha256}.tgz`;
}

/**
 * Mints a token for a key.
 * @param {{ key: string, sha256?: string, size?: number, ttlSeconds?: number, now?: Date }} input
 */
async function mint({ key, sha256 = SHA256, size = SIZE, ttlSeconds = 60, now = new Date() }) {
  const { token } = await sign({ key, sha256, size, ttlSeconds }, SECRET, now);
  return token;
}

/**
 * Sends a PUT with an explicit Content-Length.
 * @param {Miniflare} target
 * @param {string} token
 * @param {string} [body]
 */
function put(target, token, body = BODY) {
  return target.dispatchFetch(`http://localhost/u/${token}`, {
    method: "PUT",
    headers: { "Content-Length": String(Buffer.byteLength(body)) },
    body
  });
}

test("GET /health returns 200 ok", async () => {
  const res = await mf.dispatchFetch("http://localhost/health");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "ok");
});

test("/health with POST returns 405 with Allow: GET", async () => {
  const res = await mf.dispatchFetch("http://localhost/health", { method: "POST" });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("Allow"), "GET");
  assert.equal(await res.text(), "not saved: method POST is not allowed. fix: use GET");
});

test("an unknown path returns 404", async () => {
  const res = await mf.dispatchFetch("http://localhost/no-such-path");
  assert.equal(res.status, 404);
  assert.equal(await res.text(), "not found");
});

test("a valid PUT returns 201 and the object bytes match", async () => {
  const key = keyFor("valid-put");
  const res = await put(mf, await mint({ key }));
  assert.equal(res.status, 201);
  assert.match(res.headers.get("Content-Type"), /^application\/json/);
  assert.deepEqual(await res.json(), { key });
  const bucket = await mf.getR2Bucket("BUNDLES");
  const object = await bucket.get(key);
  assert.ok(object);
  assert.equal(await object.text(), BODY);
});

test("the same PUT again returns 200 and the object does not change", async () => {
  const key = keyFor("same-put-again");
  const token = await mint({ key });
  const first = await put(mf, token);
  assert.equal(first.status, 201);
  await first.arrayBuffer();
  const bucket = await mf.getR2Bucket("BUNDLES");
  const before = await bucket.head(key);
  assert.ok(before);
  const second = await put(mf, token);
  assert.equal(second.status, 200);
  assert.match(second.headers.get("Content-Type"), /^application\/json/);
  assert.deepEqual(await second.json(), { key });
  const later = await bucket.head(key);
  assert.ok(later);
  assert.equal(later.version, before.version);
  assert.equal(later.uploaded.getTime(), before.uploaded.getTime());
});

test("wrong bytes return 400 and no object remains", async () => {
  const key = keyFor("wrong-bytes");
  const wrong = "HELLO SAVE-IT";
  assert.equal(Buffer.byteLength(wrong), SIZE);
  const res = await put(mf, await mint({ key }), wrong);
  assert.equal(res.status, 400);
  assert.equal(
    await res.text(),
    "not saved: the bytes do not match sha256. fix: build the bundle again and mint a new URL"
  );
  const bucket = await mf.getR2Bucket("BUNDLES");
  assert.equal(await bucket.head(key), null);
});

test("a wrong Content-Length returns 400", async () => {
  const key = keyFor("wrong-length");
  const res = await put(mf, await mint({ key, size: SIZE + 1 }));
  assert.equal(res.status, 400);
  assert.equal(
    await res.text(),
    `not saved: Content-Length ${SIZE} is not equal to size ${SIZE + 1}. fix: build the bundle again and mint a new URL`
  );
  const bucket = await mf.getR2Bucket("BUNDLES");
  assert.equal(await bucket.head(key), null);
});

test("a Content-Length above size returns 400 and stores nothing", async () => {
  const key = keyFor("length-above-size");
  const res = await put(mf, await mint({ key, size: SIZE - 1 }));
  assert.equal(res.status, 400);
  assert.equal(
    await res.text(),
    `not saved: Content-Length ${SIZE} is not equal to size ${SIZE - 1}. fix: build the bundle again and mint a new URL`
  );
  const bucket = await mf.getR2Bucket("BUNDLES");
  assert.equal(await bucket.head(key), null);
});

test("the upload route passes request.body to put() and never buffers it", () => {
  const source = readFileSync(new URL("../src/worker.mjs", import.meta.url), "utf8");
  assert.match(source, /\.put\(\s*key\s*,\s*request\.body\s*,/);
  assert.doesNotMatch(source, /request\s*\.\s*(arrayBuffer|text|blob|json|formData)\s*\(/);
});

test("an expired token returns 410", async () => {
  const key = keyFor("expired-token");
  const now = new Date(Date.now() - 120_000);
  const res = await put(mf, await mint({ key, ttlSeconds: 60, now }));
  assert.equal(res.status, 410);
  assert.equal(await res.text(), "not saved: the upload token expired. fix: call mint_upload_url again");
});

test("a bad signature returns 403", async () => {
  const key = keyFor("bad-signature");
  const [payload, signature] = (await mint({ key })).split(".");
  const bytes = base64urlDecode(signature);
  bytes[0] ^= 0xff;
  const res = await put(mf, `${payload}.${base64urlEncode(bytes)}`);
  assert.equal(res.status, 403);
  assert.equal(await res.text(), "not saved: the upload token is not valid. fix: call mint_upload_url again");
  const bucket = await mf.getR2Bucket("BUNDLES");
  assert.equal(await bucket.head(key), null);
});

test("GET /u/<token> returns 405 with Allow: PUT", async () => {
  const key = keyFor("get-upload");
  const res = await mf.dispatchFetch(`http://localhost/u/${await mint({ key })}`);
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("Allow"), "PUT");
  assert.equal(await res.text(), "not saved: method GET is not allowed. fix: use PUT");
});

test("a missing Content-Length returns 411", async () => {
  const key = keyFor("missing-length");
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(BODY));
      controller.close();
    }
  });
  const res = await mf.dispatchFetch(`http://localhost/u/${await mint({ key })}`, {
    method: "PUT",
    body,
    duplex: "half"
  });
  assert.equal(res.status, 411);
  assert.equal(await res.text(), "not saved: Content-Length is missing. fix: send the file with curl -T");
  const bucket = await mf.getR2Bucket("BUNDLES");
  assert.equal(await bucket.head(key), null);
});

test("a PUT with a short UPLOAD_SIGNING_KEY returns 500 with the no signing key line", async () => {
  const short = new Miniflare(options({ UPLOAD_SIGNING_KEY: "short" }));
  try {
    await short.ready;
    const key = keyFor("short-signing-key");
    const res = await put(short, await mint({ key }));
    assert.equal(res.status, 500);
    assert.equal(await res.text(), "not saved: the Worker has no signing key. fix: run SETUP.md step 3");
    const bucket = await short.getR2Bucket("BUNDLES");
    assert.equal(await bucket.head(key), null);
  } finally {
    await short.dispose();
  }
});

test("/mcp without authorization returns 401 with WWW-Authenticate", async () => {
  const res = await mf.dispatchFetch("http://localhost/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
  });
  assert.equal(res.status, 401);
  assert.equal(
    res.headers.get("WWW-Authenticate"),
    'Bearer realm="OAuth", resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"'
  );
  assert.equal(await res.text(), "");
});

/**
 * Registers a client with the given redirect URIs.
 * @param {string[]} redirectUris
 */
function register(redirectUris) {
  return mf.dispatchFetch("http://localhost/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    })
  });
}

test("POST /register with a redirect URI that is not claude.ai returns 400", async () => {
  const cases = [
    ["https://attacker.example/callback"],
    ["https://claude.ai/api/mcp/auth_callback", "https://attacker.example/callback"],
    ["https://claude.ai/api/mcp/auth_callback/"],
    ["https://claude.ai.attacker.example/api/mcp/auth_callback"],
    ["https://claude.ai/api/mcp/auth_callback?x=1"]
  ];
  for (const uris of cases) {
    const res = await register(uris);
    assert.equal(res.status, 400, uris.join(" "));
    const body = await res.json();
    assert.equal(body.error, "invalid_redirect_uri", uris.join(" "));
  }
});

test("POST /register with the two claude.ai callback URIs returns 201", async () => {
  const uris = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];
  const res = await register(uris);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.deepEqual(body.redirect_uris, uris);
});

test("/authorize without Access returns 403", async () => {
  const res = await mf.dispatchFetch(
    "http://localhost/authorize?response_type=code&client_id=x&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&state=s"
  );
  assert.equal(res.status, 403);
  assert.equal(
    await res.text(),
    "not saved: Cloudflare Access did not authenticate this request. fix: protect localhost/authorize with an Access application (SETUP.md step 5)"
  );
});
