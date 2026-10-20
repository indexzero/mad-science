// Unit tests for the one email rule. Plain Node loads src/email.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedEmail } from "../src/email.mjs";

const EMAIL = "owner@example.com";

test("isAllowedEmail accepts the same email", () => {
  assert.equal(isAllowedEmail(EMAIL, EMAIL), true);
});

test("isAllowedEmail trims the email and the allowed email", () => {
  assert.equal(isAllowedEmail(` ${EMAIL} `, EMAIL), true);
  assert.equal(isAllowedEmail(EMAIL, ` ${EMAIL} `), true);
  assert.equal(isAllowedEmail(`${EMAIL}\n`, `\t${EMAIL}`), true);
});

test("isAllowedEmail refuses a different email", () => {
  assert.equal(isAllowedEmail("other@example.com", EMAIL), false);
  assert.equal(isAllowedEmail("Owner@example.com", EMAIL), false);
  assert.equal(isAllowedEmail("", EMAIL), false);
});

test("isAllowedEmail refuses when the allowed email is unset", () => {
  assert.equal(isAllowedEmail(EMAIL, undefined), false);
  assert.equal(isAllowedEmail(undefined, undefined), false);
});

test("isAllowedEmail refuses an empty allowed email", () => {
  assert.equal(isAllowedEmail("", ""), false);
  assert.equal(isAllowedEmail(" ", "  "), false);
  assert.equal(isAllowedEmail(EMAIL, ""), false);
});

test("isAllowedEmail refuses values that are not strings", () => {
  for (const value of [null, 1, true, {}, [EMAIL], { toString: () => EMAIL }]) {
    assert.equal(isAllowedEmail(value, EMAIL), false, String(value));
    assert.equal(isAllowedEmail(EMAIL, value), false, String(value));
  }
});
