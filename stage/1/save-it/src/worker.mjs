/**
 * The save-it Worker. The OAuth provider owns `/mcp`, `/token`, `/register`,
 * and the metadata paths. The default handler serves `GET /health`,
 * `PUT /u/<token>`, and `GET /authorize`. All other paths return 404.
 */

import { OAuthProvider, AuthorizationError } from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp/server";
import { createServer } from "./tool.mjs";
import { verify } from "./token.mjs";
import { isAllowedEmail } from "./email.mjs";

const ALLOWED_REDIRECT_URIS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback"
];

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
  if (!/^\d+$/.test(length) || Number(length) !== size) {
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

const NOT_VALID_AUTH_REQUEST =
  "not saved: the authorization request is not valid. fix: add the connector again in claude.ai";

/**
 * Answers `/authorize`. Cloudflare Access is the identity provider.
 * The steps follow the design "OAuth and MCP" in order.
 * @param {Request} request
 * @param {{ ALLOWED_EMAIL?: string, OAUTH_PROVIDER: any }} env
 * @param {{ access?: { getIdentity(): Promise<{ email?: string } | undefined> } }} ctx
 * @returns {Promise<Response>}
 */
async function authorize(request, env, ctx) {
  if (request.method !== "GET") {
    return text(
      `not saved: method ${request.method} is not allowed. fix: use GET`,
      405,
      { Allow: "GET" }
    );
  }
  if (ctx?.access === undefined) {
    const host = new URL(request.url).host;
    return text(
      `not saved: Cloudflare Access did not authenticate this request. fix: protect ${host}/authorize with an Access application (SETUP.md step 5)`,
      403
    );
  }
  const identity = await ctx.access.getIdentity();
  if (!isAllowedEmail(identity?.email, env.ALLOWED_EMAIL)) {
    return text("not saved: this account is not allowed. fix: sign in as the allowed email", 403);
  }
  const email = identity.email.trim();
  let authRequest;
  try {
    authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) {
      return Response.redirect(error.redirectTo, 302);
    }
    return text(NOT_VALID_AUTH_REQUEST, 400);
  }
  const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  if (client === null) {
    return text(NOT_VALID_AUTH_REQUEST, 400);
  }
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: authRequest,
    userId: email,
    metadata: {},
    scope: authRequest.scope,
    props: { email }
  });
  return Response.redirect(redirectTo, 302);
}

/**
 * Answers every request that the OAuth provider does not own.
 * It reads the clock once and passes the time to upload().
 * @param {Request} request
 * @param {{ BUNDLES: R2Bucket, UPLOAD_SIGNING_KEY?: string, ALLOWED_EMAIL?: string, OAUTH_PROVIDER: any }} env
 * @param {any} ctx
 * @returns {Promise<Response>}
 */
async function defaultFetch(request, env, ctx) {
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
  if (url.pathname === "/authorize") {
    return authorize(request, env, ctx);
  }
  return text("not found", 404);
}

const providers = new Map();

/**
 * Gives the OAuth provider for one origin. The provider needs the origin
 * for `resourceMetadata.resource`, so the Worker makes one per origin.
 * @param {string} origin  new URL(request.url).origin
 * @returns {OAuthProvider}
 */
function providerFor(origin) {
  let provider = providers.get(origin);
  if (provider) return provider;
  provider = new OAuthProvider({
    apiRoute: "/mcp",
    apiHandler: {
      fetch(request, env, ctx) {
        const handler = createMcpHandler(() => createServer(env, origin));
        return handler(request, env, ctx);
      }
    },
    defaultHandler: { fetch: defaultFetch },
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    resourceMetadata: { resource: `${origin}/mcp` },
    clientRegistrationCallback({ clientMetadata }) {
      const uris = Array.isArray(clientMetadata.redirect_uris) ? clientMetadata.redirect_uris : [];
      const bad = uris.find((uri) => !ALLOWED_REDIRECT_URIS.includes(uri));
      if (uris.length === 0 || bad !== undefined) {
        return { code: "invalid_redirect_uri", description: "redirect_uris must be the claude.ai or claude.com auth callback", status: 400 };
      }
    }
  });
  providers.set(origin, provider);
  return provider;
}

export default {
  fetch(request, env, ctx) {
    return providerFor(new URL(request.url).origin).fetch(request, env, ctx);
  }
};
