/**
 * The one email rule for `/authorize` and the tool. This module imports
 * nothing, so plain Node can load it.
 */

/**
 * Tells if an email is the allowed email.
 * Both values must be strings. The trimmed allowed email must not be empty.
 * The trimmed values must be equal. Case matters.
 * @param {unknown} email    the email to check
 * @param {unknown} allowed  the value of `ALLOWED_EMAIL`
 * @returns {boolean}
 */
export function isAllowedEmail(email, allowed) {
  if (typeof email !== "string" || typeof allowed !== "string") {
    return false;
  }
  const want = allowed.trim();
  return want !== "" && email.trim() === want;
}
