/**
 * The save-it Worker. Build 1 serves `GET /health` only.
 * All other paths return 404.
 */

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
 * Answers one request.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function fetch(request) {
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
  return text("not found", 404);
}

export default { fetch };
