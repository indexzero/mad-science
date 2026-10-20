/**
 * The upload token. The token is `base64url(payload) + "." + base64url(hmac)`.
 * The hmac is HMAC-SHA256 over the exact payload bytes, through Web Crypto.
 * The Worker never stores a token.
 */

/**
 * @typedef {{ key: string, sha256: string, size: number, exp: number }} TokenPayload
 * @typedef {"malformed" | "bad-signature" | "expired"} TokenFailure
 */

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Encodes bytes as base64url with no padding.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function base64urlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decodes base64url with no padding. Returns null if the text is not base64url.
 * @param {string} text
 * @returns {Uint8Array | null}
 */
export function base64urlDecode(text) {
  if (!BASE64URL_RE.test(text) || text.length % 4 === 1) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  let binary;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Imports the secret as an HMAC-SHA256 key.
 * @param {string} secret
 * @returns {Promise<CryptoKey>}
 */
function importSecret(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/**
 * Makes sure that the parsed value has the four keys with their types.
 * @param {unknown} value
 * @returns {value is TokenPayload}
 */
function isPayload(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const p = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof p.key === "string" &&
    typeof p.sha256 === "string" &&
    Number.isInteger(p.size) &&
    Number.isInteger(p.exp)
  );
}

/**
 * Signs a payload. `exp` is floor(now / 1000) + ttlSeconds.
 * @param {{ key: string, sha256: string, size: number, ttlSeconds: number }} input
 * @param {string} secret   UPLOAD_SIGNING_KEY
 * @param {Date} now        the injected clock
 * @returns {Promise<{ token: string, exp: number }>}
 */
export async function sign(input, secret, now) {
  const exp = Math.floor(now.getTime() / 1000) + input.ttlSeconds;
  const payload = { key: input.key, sha256: input.sha256, size: input.size, exp };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const cryptoKey = await importSecret(secret);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, payloadBytes));
  return { token: `${base64urlEncode(payloadBytes)}.${base64urlEncode(hmac)}`, exp };
}

/**
 * Verifies a token. Splits and decodes, then checks the signature, then parses the payload, then checks expiry, in that order.
 * @param {string} token
 * @param {string} secret
 * @param {Date} now
 * @returns {Promise<{ ok: true, payload: TokenPayload } | { ok: false, kind: TokenFailure }>}
 */
export async function verify(token, secret, now) {
  if (typeof token !== "string") return { ok: false, kind: "malformed" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, kind: "malformed" };
  const [payloadPart, signaturePart] = parts;
  const payloadBytes = base64urlDecode(payloadPart);
  const signatureBytes = base64urlDecode(signaturePart);
  if (payloadBytes === null || signatureBytes === null) return { ok: false, kind: "malformed" };
  if (
    base64urlEncode(payloadBytes) !== payloadPart ||
    base64urlEncode(signatureBytes) !== signaturePart
  ) {
    return { ok: false, kind: "malformed" };
  }

  const cryptoKey = await importSecret(secret);
  const valid = await crypto.subtle.verify("HMAC", cryptoKey, signatureBytes, payloadBytes);
  if (!valid) return { ok: false, kind: "bad-signature" };

  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
  } catch {
    return { ok: false, kind: "malformed" };
  }
  if (!isPayload(payload)) return { ok: false, kind: "malformed" };

  if (payload.exp < Math.floor(now.getTime() / 1000)) return { ok: false, kind: "expired" };
  const { key, sha256, size, exp } = payload;
  return { ok: true, payload: { key, sha256, size, exp } };
}
