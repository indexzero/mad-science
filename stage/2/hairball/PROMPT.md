# Task: Make the "save it" system for Claude chat bundles

## 1. Goal

The user says "save it" in a Claude chat.
Claude puts one bundle of that chat into one Cloudflare R2 bucket.
Claude then shows exactly one line to the user:

- On success: `saved: <key>`
- On failure: `not saved: <reason>. fix: <fix>`

A bundle is one `.tgz` file. It contains the chat inputs, the chat outputs, a transcript, and a manifest.

You will make two parts:

1. A Cloudflare Worker. It is a remote MCP server behind OAuth. It also accepts uploads and writes them to R2.
2. A Claude skill named `save-it`. It holds the workflow. It holds no secrets.

## 2. Design principles

- Jef Raskin, "The Humane Interface": the user has one locus of attention. Each save must cost the user nothing more than the words "save it". All other cost occurs one time, at setup.
- Gall's Law: make the simplest system that works. Do not add a feature that this prompt does not specify.
- If this prompt and these principles do not agree, stop and tell me.

## 3. Language rules

- Write in ASD-STE100 Simplified Technical English.
- Use STE for documents, code comments, test names, error messages, commit messages, and all reports to me.
- Procedural sentences: 20 words maximum. Descriptive sentences: 25 words maximum.
- Use the active voice. Write one instruction in each sentence.
- Do not use em dashes.

## 4. Checks before you start

Do these checks before you write code:

1. Make sure that `pnpm` is available.
2. Make sure that Node.js is version 22 or later.
3. Read the current official Cloudflare documentation for these items:
   - `createMcpHandler` from `agents/mcp/server` (stateless MCP server).
   - `@cloudflare/workers-oauth-provider`.
   - Cloudflare Access as the upstream identity provider for an MCP server.
   - The R2 Workers API: `put()` with checksum options, and `head()`.
   - Miniflare.
4. Examine the skills that are available to you.

If a check fails, stop. Tell me what is not available.
If the official documentation does not agree with this prompt, stop. Tell me the difference. Do not guess.
If you need a skill that is not available, stop and tell me.

## 5. Stack

- Use `pnpm`. Do not make npm or yarn lock files.
- Use JavaScript ES modules with JSDoc types. Do not add a TypeScript build step.
- Use official Cloudflare packages: `wrangler`, `agents`, `@cloudflare/workers-oauth-provider`, and `miniflare`.
- Use `@modelcontextprotocol/server` at the exact version that the installed `agents` release requires.
- Use Node.js built-in modules for all other work: `node:test`, `node:assert/strict`, `node:crypto`, `node:zlib`, `node:fs`, `node:path`.
- Do not add other third-party packages. If an official package requires one, write the reason in `DECISIONS.md`.
- Use the Node.js test runner (`node --test`). Do not use Vitest or Jest.

## 6. Object key

The Worker composes the key. The Worker never parses a key. The caller never sends a key.

Format: `{date}-{source}-{topic}-{sha256}.tgz`

Example: `2026-09-26-claude-mobile-3coin-in-3d-a9b7df43aa05a12f3f7c4265fd61a8d50029c3a2a28a12f231bad480747cc8ab.tgz`

| Field | Rule | Example |
|---|---|---|
| `date` | `YYYY-MM-DD`. A real calendar date. Not more than one day from the Worker UTC date. | `2026-09-26` |
| `source` | One of: `claude-mobile`, `claude-web`, `claude-code`. | `claude-mobile` |
| `topic` | Matches `^[a-z0-9]+(-[a-z0-9]+)*$`. 32 characters maximum. | `3coin-in-3d` |
| `sha256` | 64 lowercase hexadecimal characters. | `a9b7df43aa05a12f3f7c4265fd61a8d50029c3a2a28a12f231bad480747cc8ab` |
| `size` | Positive integer, in bytes. Not more than `MAX_BYTES` (default 52428800). | `480981` |

- The key has no leading slash.
- The key alphabet is `a-z`, `0-9`, and `-`. The only `.` is in `.tgz`.

## 7. MCP tool: `mint_upload_url`

- Input: the five fields in section 6, as separate arguments.
- Validate each field. If a field is not valid, return an error. The error must name the field and the rule.
- Output: `{ "key": "...", "url": "https://<worker-host>/u/<token>", "expires_at": "<ISO 8601 UTC>" }`
- The URL is valid for `UPLOAD_TTL_SECONDS` (default 60).
- The token is an HMAC-SHA256 signature over `key`, `sha256`, `size`, and the expiry time. Use Web Crypto. Use the secret `UPLOAD_SIGNING_KEY`. Encode the token as base64url.
- Do not store tokens. Do not use KV or Durable Objects for tokens.
- Register this tool only. Do not add other tools.

## 8. Upload route: `PUT /u/<token>`

This route is not behind OAuth. The token is the authorization.

Do these steps in this order:

1. If the method is not `PUT`, return 405.
2. Verify the token signature. If it is not valid, return 403.
3. If the token is expired, return 410.
4. If there is no `Content-Length`, return 411.
5. If `Content-Length` is not equal to `size`, return 400.
6. If an object with the key exists, return 200 with `{ "key": "..." }`. Do not write again.
7. Stream the body into R2 with `put()`. Give the `sha256` checksum option. Do not read the full body into memory.
8. If R2 rejects the checksum, return 400. Make sure that no object remains.
9. On success, return 201 with `{ "key": "..." }`.

Also add `GET /health`. It returns 200 and the text `ok`. It is not behind OAuth. The skill uses it for a network check.

## 9. OAuth

- Use `OAuthProvider` from `@cloudflare/workers-oauth-provider`.
- Serve the MCP server with `apiRoute: "/mcp"` and `apiHandler: createMcpHandler(createServer)`.
- Put `/u/<token>`, `/health`, and the identity provider routes in the default handler.
- Use Cloudflare Access as the upstream identity provider.
- Allow one user only. Compare the email from Access with the variable `ALLOWED_EMAIL`. Reject all other users.
- Allow these redirect URIs: `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback`.
- Keep the default stateless legacy compatibility of `createMcpHandler`. Claude custom connectors must connect to it.
- Use the KV namespace that the OAuth library requires. Name the binding `OAUTH_KV`.

## 10. Skill: `save-it`

The skill runs in the claude.ai code execution sandbox. The sandbox is Linux with Node.js 22. Network access is limited to allowed domains.

Files:

- `skill/save-it/SKILL.md`
- `skill/save-it/scripts/bundle.mjs`
- `skill/save-it/scripts/tar.mjs`

`SKILL.md` frontmatter:

- `name: save-it`
- `description`: 200 characters maximum. It must trigger when the user says "save it" or asks to save the chat to the bucket.

`SKILL.md` body. Tell Claude to do these steps in this order:

1. Run `node scripts/bundle.mjs --check`. It sends `GET /health` to the Worker. If it fails, show the one failure line and stop.
2. Get the local date of the user from the device clock tool. If no clock tool is available, use the UTC date.
3. Select the source for the current Claude surface.
4. Make a topic that obeys the rule in section 6.
5. Write `/tmp/save-it/TRANSCRIPT.md` from the chat context. The first line must say: "This transcript was reconstructed by Claude. It is not an export."
6. Run `node scripts/bundle.mjs --date <date> --source <source> --topic <topic> --transcript /tmp/save-it/TRANSCRIPT.md`.
7. Call the MCP tool `mint_upload_url` with the fields that the script prints.
8. Upload with `curl --fail --silent --show-error -T <path> <url>`. Use curl, because the sandbox network uses a proxy.
9. Show exactly one line: `saved: <key>` or `not saved: <reason>. fix: <fix>`.
10. Do not ask the user questions. Do not show other text.

`bundle.mjs`:

- Use Node.js built-in modules only.
- Collect files from `/mnt/user-data/uploads` into `inputs/`.
- Collect files from `/mnt/user-data/outputs` into `outputs/`.
- Add the transcript as `TRANSCRIPT.md` at the root.
- Write `manifest.json` at the root. For each file, record `path`, `sha256`, `size`, and `origin` (`input`, `output`, or `transcript`). Also record `date`, `source`, `topic`, and `"transcript": "reconstructed"`.
- Make the tarball with `tar.mjs`. Compress it with `node:zlib` gzip. Write it to `/tmp/save-it/`.
- Print one JSON object: `{ "date", "source", "topic", "sha256", "size", "path" }`.
- Put the Worker host in one constant at the top of the file.

`tar.mjs`:

- Write a USTAR archive writer. Use Node.js built-in modules only.
- Make the output deterministic. Sort paths by byte order. Set mtime to 0. Set uid and gid to 0. Set uname and gname to empty. Set file mode to 0644.
- The same inputs must give the same bytes.
- If a path is too long for USTAR, fail with a clear error. Do not add PAX support.

Packaging:

- Add the script `pnpm skill:pack <worker-host>`.
- It writes the host into `bundle.mjs`.
- It makes `dist/save-it.zip`. The zip root is one folder, `save-it/`. Use the system `zip` command.

## 11. Tests

Use `node --test`. Inject the clock into all time-dependent functions.

Unit tests:

- Key: each field with valid and not valid values. Use the example values in section 6. Make sure that the composed key is equal to the example key.
- Token: sign and verify, a tampered token, an expired token, a wrong secret.
- Tar: build the same inputs two times. Make sure that the bytes are equal. If the system `tar` is available, make sure that `tar -tzf` lists the correct paths.
- Manifest: correct fields, hashes, sizes, and origins.
- Tool: call the tool handler directly with valid and not valid input.

Integration tests with Miniflare:

- Bundle the Worker with `wrangler deploy --dry-run --outdir`. Load the output in Miniflare with in-memory R2 and KV.
- `GET /health` returns 200.
- A valid upload returns 201. The object has the correct key and bytes.
- The same upload again returns 200. The object does not change.
- Wrong bytes return 400. No object remains.
- A wrong `Content-Length` returns 400.
- An expired token returns 410.
- A bad signature returns 403.
- `GET /u/<token>` returns 405.
- `/mcp` without authorization returns 401.

## 12. Cloudflare account

- Do not run commands that change my Cloudflare account. Do not deploy.
- Write each one-time setup step in `SETUP.md`, in this order:
  1. Create the R2 bucket. Bind it as `BUNDLES`.
  2. Create the KV namespace. Bind it as `OAUTH_KV`.
  3. Set the secret `UPLOAD_SIGNING_KEY`.
  4. Set the variable `ALLOWED_EMAIL`.
  5. Configure Cloudflare Access.
  6. Deploy with `pnpm run deploy`.
  7. Add the Worker `/mcp` URL as a custom connector in claude.ai on the web. The Android app can use custom connectors but cannot add them.
  8. Turn on network access for code execution in claude.ai. Allow the Worker host.
  9. Upload `dist/save-it.zip` as a skill in claude.ai.

## 13. Not in scope

Do not make these items:

- GitHub pull requests.
- Unpacking bundles.
- Listing or reading the bucket.
- Routing by source.
- Duplicate detection across dates.
- A user interface.
- Support for more than one user.

## 14. Done

The task is done when all of these conditions are true:

- `pnpm install` completes with no errors.
- `pnpm test` passes.
- `wrangler deploy --dry-run` completes with no errors.
- `dist/save-it.zip` exists.
- `README.md`, `SETUP.md`, and `DECISIONS.md` exist and use STE.

## 15. Report

When you finish, tell me in STE:

- What you made.
- What you did not make, and why.
- Each decision in `DECISIONS.md`.
- Each difference from this prompt.