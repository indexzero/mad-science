import { test } from "node:test";
import assert from "node:assert/strict";
import { validate, compose, SOURCES, DEFAULT_MAX_BYTES } from "../src/key.mjs";

const VECTOR = {
  date: "2026-09-26",
  source: "claude-mobile",
  topic: "3coin-in-3d",
  sha256: "a9b7df43aa05a12f3f7c4265fd61a8d50029c3a2a28a12f231bad480747cc8ab",
  size: 480981
};
const VECTOR_KEY =
  "2026-09-26-claude-mobile-3coin-in-3d-a9b7df43aa05a12f3f7c4265fd61a8d50029c3a2a28a12f231bad480747cc8ab.tgz";
const OPTIONS = { now: new Date("2026-09-26T12:00:00Z"), maxBytes: DEFAULT_MAX_BYTES };

/**
 * Validates the vector with one field replaced.
 * @param {string} field
 * @param {unknown} value
 */
function withField(field, value) {
  return validate({ ...VECTOR, [field]: value }, OPTIONS);
}

/**
 * Asserts that the result fails on the field and the message names it.
 * @param {ReturnType<typeof validate>} result
 * @param {string} field
 * @param {string} label
 */
function assertFails(result, field, label) {
  assert.equal(result.ok, false, label);
  if (result.ok) return;
  assert.equal(result.field, field, label);
  assert.ok(result.message.startsWith(`${field}:`), label);
}

test("validate accepts the [25] vector", () => {
  const result = validate(VECTOR, OPTIONS);
  assert.deepEqual(result, { ok: true, fields: VECTOR });
  assert.deepEqual(SOURCES, ["claude-mobile", "claude-web", "claude-code"]);
});

test("compose equals the [25] key", () => {
  assert.equal(compose(VECTOR), VECTOR_KEY);
});

test("date: rejects a malformed string, a non-calendar date (2026-02-30), and a date two days away", () => {
  assertFails(withField("date", "2026-9-26"), "date", "malformed");
  // 2026-02-30 rolls over to 2026-03-02. That is one day from this clock, so only the calendar check rejects it.
  assertFails(
    validate({ ...VECTOR, date: "2026-02-30" }, { ...OPTIONS, now: new Date("2026-03-01T12:00:00Z") }),
    "date",
    "non-calendar"
  );
  assertFails(withField("date", "2026-09-28"), "date", "two days after");
  assertFails(withField("date", "2026-09-24"), "date", "two days before");
  assertFails(withField("date", undefined), "date", "missing");
});

test("date: accepts yesterday and tomorrow", () => {
  assert.equal(withField("date", "2026-09-25").ok, true);
  assert.equal(withField("date", "2026-09-27").ok, true);
});

test("source: rejects claude-desktop and an empty string", () => {
  assertFails(withField("source", "claude-desktop"), "source", "claude-desktop");
  assertFails(withField("source", ""), "source", "empty");
});

test("source: rejects claude-web-foo", () => {
  assertFails(withField("source", "claude-web-foo"), "source", "claude-web-foo");
});

test("source: accepts each member of SOURCES", () => {
  for (const source of SOURCES) {
    assert.equal(withField("source", source).ok, true, source);
  }
});

test("topic: rejects uppercase, a leading hyphen, a double hyphen, a 33-character value, and an empty string", () => {
  assertFails(withField("topic", "Coin"), "topic", "uppercase");
  assertFails(withField("topic", "-coin"), "topic", "leading hyphen");
  assertFails(withField("topic", "coin--bank"), "topic", "double hyphen");
  assertFails(withField("topic", "a".repeat(33)), "topic", "33 characters");
  assertFails(withField("topic", ""), "topic", "empty");
});

test("topic: accepts 3coin-in-3d and a 32-character value", () => {
  assert.equal(withField("topic", "3coin-in-3d").ok, true);
  assert.equal(withField("topic", "a".repeat(32)).ok, true);
});

test("sha256: rejects uppercase hex, 63 characters, and 65 characters", () => {
  assertFails(withField("sha256", VECTOR.sha256.toUpperCase()), "sha256", "uppercase");
  assertFails(withField("sha256", VECTOR.sha256.slice(1)), "sha256", "63 characters");
  assertFails(withField("sha256", `${VECTOR.sha256}0`), "sha256", "65 characters");
});

test("size: rejects 0, a negative, a float, a numeric string, and MAX_BYTES + 1", () => {
  assertFails(withField("size", 0), "size", "zero");
  assertFails(withField("size", -1), "size", "negative");
  assertFails(withField("size", 1.5), "size", "float");
  assertFails(withField("size", "480981"), "size", "numeric string");
  const result = withField("size", DEFAULT_MAX_BYTES + 1);
  assertFails(result, "size", "MAX_BYTES + 1");
  assert.equal(
    !result.ok && result.message,
    `size: must be a positive integer not more than ${DEFAULT_MAX_BYTES}`
  );
});

test("size: accepts 1 and MAX_BYTES", () => {
  assert.equal(withField("size", 1).ok, true);
  assert.equal(withField("size", DEFAULT_MAX_BYTES).ok, true);
});

test("size: an injected maxBytes of 3 accepts 3 and rejects 4", () => {
  const options = { ...OPTIONS, maxBytes: 3 };
  assert.equal(validate({ ...VECTOR, size: 3 }, options).ok, true);
  const result = validate({ ...VECTOR, size: 4 }, options);
  assertFails(result, "size", "4");
  assert.equal(!result.ok && result.message, "size: must be a positive integer not more than 3");
});

test("each field: rejects missing, undefined, null, an array, an object, and a wrong type", () => {
  // A type error must give the same message as a value error.
  const wrongValue = { date: "x", source: "x", topic: "X", sha256: "x", size: 0 };
  const wrongType = { date: 20260926, source: 1, topic: 3, sha256: 0, size: "480981" };
  for (const field of ["date", "source", "topic", "sha256", "size"]) {
    const expected = withField(field, wrongValue[field]);
    assert.equal(expected.ok, false, field);
    const missing = { ...VECTOR };
    delete missing[field];
    const cases = [
      ["missing", validate(missing, OPTIONS)],
      ["undefined", withField(field, undefined)],
      ["null", withField(field, null)],
      ["an array", withField(field, [VECTOR[field]])],
      ["an object", withField(field, { value: VECTOR[field] })],
      ["a wrong type", withField(field, wrongType[field])]
    ];
    if (field === "size") cases.push(["a boolean", withField(field, true)]);
    for (const [label, result] of cases) {
      assert.deepEqual(result, expected, `${field}: ${label}`);
    }
  }
});

test("validate stops at the first failure in field order", () => {
  const bad = { date: "x", source: "x", topic: "X", sha256: "x", size: 0 };
  const order = ["date", "source", "topic", "sha256", "size"];
  for (let i = 0; i < order.length; i++) {
    const input = { ...VECTOR };
    for (const field of order.slice(i)) input[field] = bad[field];
    assertFails(validate(input, OPTIONS), order[i], `from ${order[i]}`);
  }
  assertFails(validate(undefined, OPTIONS), "date", "no input");
});
