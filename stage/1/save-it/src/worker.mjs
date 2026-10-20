/**
 * The save-it Worker. Build 2 serves `GET /health` and `PUT /u/<token>`.
 * All other paths return 404.
 */

import { verify } from "./token.mjs";

const NO_SIGNING_KEY = "not saved: the Worker has no signing key. fix: run SETUP.md step 3";

/**
 * Makes a plain text response.
 * @param {string} body
 * @param {number} status
 * @param {Record<string, string>} [headers]
 * @returns {Response}
 */
function text(body, status, headers = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...headers }
  });
}

/**
 * Makes a JSON response with the key.
 * @param {string} key
 * @param {number} status
 * @returns {Response}
 */
function keyJson(key, status) {
  return new Response(JSON.stringify({ key }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

/**
 * Tells if the signing key is present and has 32 bytes or more in UTF-8.
 * @param {unknown} secret
 * @returns {secret is string}
 */
function hasSigningKey(secret) {
  return typeof secret === "string" && new TextEncoder().encode(secret).length >= 32;
}

/**
 * Answers `/u/<token>`. The steps follow the design "Routes" in order.
 * The key comes from the verified token payload only.
 * The body goes to R2 as a stream. The Worker never reads it.
 * @param {Request} request
 * @param {{ BUNDLES: R2Bucket, UPLOAD_SIGNING_KEY?: string }} env
 * @param {string} token
 * @param {Date} now
 * @returns {Promise<Response>}
 */
async function upload(request, env, token, now) {
  if (request.method !== "PUT") {
    return text(
      `not saved: method ${request.method} is not allowed. fix: use PUT`,
      405,
      { Allow: "PUT" }
    );
  }
  if (!hasSigningKey(env.UPLOAD_SIGNING_KEY)) {
    return text(NO_SIGNING_KEY, 500);
  }
  const result = await verify(token, env.UPLOAD_SIGNING_KEY, now);
  if (!result.ok) {
    if (result.kind === "expired") {
      return text("not saved: the upload token expired. fix: call mint_upload_url again", 410);
    }
    return text("not saved: the upload token is not valid. fix: call mint_upload_url again", 403);
  }
  const { key, sha256, size } = result.payload;
  const length = request.headers.get("Content-Length");
  if (length === null) {
    return text("not saved: Content-Length is missing. fix: send the file with curl -T", 411);
  }
  if (Number(length) !== size) {
    return text(
      `not saved: Content-Length ${length} is not equal to size ${size}. fix: build the bundle again and mint a new URL`,
      400
    );
  }
  if ((await env.BUNDLES.head(key)) !== null) {
    return keyJson(key, 200);
  }
  try {
    await env.BUNDLES.put(key, request.body, { sha256 });
  } catch {
    if ((await env.BUNDLES.head(key)) !== null) {
      return text("not saved: an object remained after a rejected upload. fix: report this", 500);
    }
    return text("not saved: the bytes do not match sha256. fix: build the bundle again and mint a new URL", 400);
  }
  return keyJson(key, 201);
}

/**
 * Answers one request. The clock is read once here and passed down.
 * @param {Request} request
 * @param {{ BUNDLES: R2Bucket, UPLOAD_SIGNING_KEY?: string }} env
 * @returns {Promise<Response>}
 */
async function fetch(request, env) {
  const now = new Date();
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    if (request.method !== "GET") {
      return text(
        `not saved: method ${request.method} is not allowed. fix: use GET`,
        405,
        { Allow: "GET" }
      );
    }
    return text("ok", 200);
  }
  if (url.pathname.startsWith("/u/")) {
    return upload(request, env, url.pathname.slice("/u/".length), now);
  }
  return text("not found", 404);
}

export default { fetch };
