/**
 * The object key grammar. The Worker composes the key from five fields.
 * Nothing in the project parses a key.
 */

/**
 * @typedef {object} KeyFields
 * @property {string} date    YYYY-MM-DD
 * @property {string} source  claude-mobile | claude-web | claude-code
 * @property {string} topic   ^[a-z0-9]+(-[a-z0-9]+)*$, 32 characters at most
 * @property {string} sha256  64 lowercase hex characters
 * @property {number} size    positive integer, bytes
 */

/**
 * @typedef {{ ok: true, fields: KeyFields } | { ok: false, field: keyof KeyFields, message: string }} ValidationResult
 */

/**
 * The three permitted values of the source field.
 * @type {string[]}
 */
export const SOURCES = ["claude-mobile", "claude-web", "claude-code"];

/**
 * The default upper limit of the size field, in bytes.
 * @type {number}
 */
export const DEFAULT_MAX_BYTES = 52428800;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_RE = /^(claude-mobile|claude-web|claude-code)$/;
const TOPIC_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const DAY_MS = 86400000;
const TOPIC_MAX = 32;

const DATE_MESSAGE =
  "date: must be YYYY-MM-DD, a real calendar date, not more than one day from the Worker UTC date";
const SOURCE_MESSAGE = "source: must be one of claude-mobile, claude-web, claude-code";
const TOPIC_MESSAGE =
  "topic: must match ^[a-z0-9]+(-[a-z0-9]+)*$ and have 32 characters at most";
const SHA256_MESSAGE = "sha256: must be 64 lowercase hexadecimal characters";

/**
 * Makes sure that the date is a real UTC calendar date in the one-day window.
 * @param {unknown} value
 * @param {Date} now
 * @returns {boolean}
 */
function isValidDate(value, now) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== m - 1 ||
    back.getUTCDate() !== d
  ) {
    return false;
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.abs(ms - today) <= DAY_MS;
}

/**
 * Validates the five fields in the order date, source, topic, sha256, size.
 * Stops at the first failure. The message names the field.
 * @param {unknown} input         the raw arguments
 * @param {{ now: Date, maxBytes: number }} options  the injected clock and the cap
 * @returns {ValidationResult}
 */
export function validate(input, options) {
  const { now, maxBytes } = options;
  /** @type {Record<string, unknown>} */
  const raw = input !== null && typeof input === "object" ? /** @type {any} */ (input) : {};
  const { date, source, topic, sha256, size } = raw;

  if (!isValidDate(date, now)) {
    return { ok: false, field: "date", message: DATE_MESSAGE };
  }
  if (typeof source !== "string" || !SOURCE_RE.test(source)) {
    return { ok: false, field: "source", message: SOURCE_MESSAGE };
  }
  if (typeof topic !== "string" || topic.length > TOPIC_MAX || !TOPIC_RE.test(topic)) {
    return { ok: false, field: "topic", message: TOPIC_MESSAGE };
  }
  if (typeof sha256 !== "string" || !SHA256_RE.test(sha256)) {
    return { ok: false, field: "sha256", message: SHA256_MESSAGE };
  }
  if (typeof size !== "number" || !Number.isInteger(size) || size < 1 || size > maxBytes) {
    return {
      ok: false,
      field: "size",
      message: `size: must be a positive integer not more than ${maxBytes}`
    };
  }
  return {
    ok: true,
    fields: {
      date: /** @type {string} */ (date),
      source,
      topic,
      sha256,
      size
    }
  };
}

/**
 * Composes the key from validated fields. Never parses a key.
 * @param {Pick<KeyFields, "date" | "source" | "topic" | "sha256">} fields
 * @returns {string} `${date}-${source}-${topic}-${sha256}.tgz`
 */
export function compose(fields) {
  const { date, source, topic, sha256 } = fields;
  return `${date}-${source}-${topic}-${sha256}.tgz`;
}
