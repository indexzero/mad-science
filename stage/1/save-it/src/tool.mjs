/**
 * The MCP tool `mint_upload_url`. This module never imports
 * `@cloudflare/workers-oauth-provider`, so plain Node can load it.
 */

import { getMcpAuthContext } from "agents/mcp/server";
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { validate, compose, DEFAULT_MAX_BYTES } from "./key.mjs";
import { sign } from "./token.mjs";

/**
 * @typedef {object} ToolEnv
 * @property {string} [ALLOWED_EMAIL]       the one allowed email
 * @property {string} [UPLOAD_SIGNING_KEY]  the HMAC secret, 32 UTF-8 bytes or more
 * @property {string} [MAX_BYTES]           the size cap, default 52428800
 * @property {string} [UPLOAD_TTL_SECONDS]  the token lifetime, default 60
 */

/**
 * @typedef {{ content: { type: "text", text: string }[], isError?: true }} ToolResult
 */

/**
 * Makes an error result with one text block.
 * @param {string} message
 * @returns {ToolResult}
 */
function failure(message) {
  return { isError: true, content: [{ type: "text", text: message }] };
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
 * Mints a one-time upload URL. The steps follow the design "OAuth and MCP" in order.
 * @param {unknown} args  the five tool arguments
 * @param {{ env: ToolEnv, origin: string, now: Date, authContext?: { props?: Record<string, unknown> } }} options
 *   `authContext` defaults to `getMcpAuthContext()`. Tests give a stub.
 * @returns {Promise<ToolResult>}
 */
export async function mintUploadUrl(args, { env, origin, now, authContext }) {
  const email = (authContext ?? getMcpAuthContext())?.props?.email;
  if (email !== env.ALLOWED_EMAIL) {
    return failure("not saved: this token is not for the allowed email. fix: add the connector again");
  }
  if (!hasSigningKey(env.UPLOAD_SIGNING_KEY)) {
    return failure("not saved: the Worker has no signing key. fix: run SETUP.md step 3");
  }
  const result = validate(args, { now, maxBytes: Number(env.MAX_BYTES ?? DEFAULT_MAX_BYTES) });
  if (!result.ok) {
    return failure("not valid: " + result.message);
  }
  const { sha256, size } = result.fields;
  const key = compose(result.fields);
  const { token, exp } = await sign(
    { key, sha256, size, ttlSeconds: Number(env.UPLOAD_TTL_SECONDS ?? 60) },
    env.UPLOAD_SIGNING_KEY,
    now
  );
  const body = { key, url: `${origin}/u/${token}`, expires_at: new Date(exp * 1000).toISOString() };
  return { content: [{ type: "text", text: JSON.stringify(body) }] };
}

/**
 * Makes the MCP server with the one tool.
 * @param {ToolEnv} env
 * @param {string} origin  the Worker origin, for the upload URL
 * @returns {McpServer}  a fresh instance per request
 */
export function createServer(env, origin) {
  const server = new McpServer({ name: "save-it", version: "0.1.0" });
  server.registerTool(
    "mint_upload_url",
    {
      description: "Mints a one-time upload URL for one chat bundle. Give date (YYYY-MM-DD), source (claude-mobile, claude-web, claude-code), topic (lowercase words joined by hyphens, 32 characters at most), sha256 (64 lowercase hex), and size (bytes).",
      inputSchema: z.object({
        date: z.string().describe("YYYY-MM-DD, the local date of the user"),
        source: z.string().describe("claude-mobile, claude-web, or claude-code"),
        topic: z.string().describe("lowercase a-z0-9 words joined by single hyphens, 32 characters at most"),
        sha256: z.string().describe("64 lowercase hexadecimal characters"),
        size: z.number().int().describe("size of the .tgz in bytes")
      })
    },
    (args) => mintUploadUrl(args, { env, origin, now: new Date() })
  );
  return server;
}
