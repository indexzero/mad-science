---
title: "save-it decisions"
status: "built, not deployed"
project: save-it
stage: 1
source_prompt: PROMPT.md
design: "TECHNICAL.DESIGN.md in the orckits run home indexzero/mad-science/2026-10-save-it/"
---

# save-it decisions

This file names each third-party package and the reason for it. Then it gives the design decisions. The last section lists each difference from `PROMPT.md`.

## Packages

`package.json` pins each package at an exact version. `pnpm-lock.yaml` holds the full tree. Node built-ins do all other work.

### `wrangler` 4.151.3

A dev dependency. It is the official Cloudflare build and deploy tool. The tests use `wrangler deploy --dry-run` to make the bundle that Miniflare loads. The owner uses `pnpm run deploy` at SETUP.md step 6.

### `agents` 0.29.0

A dependency. It gives `createMcpHandler` and `getMcpAuthContext` from `agents/mcp/server`. `createMcpHandler` serves the MCP server at `/mcp` with no Durable Object. `getMcpAuthContext` gives the tool the email from the OAuth grant.

### `@cloudflare/workers-oauth-provider` 1.2.3

A dependency. It is the OAuth 2.1 provider for `/mcp`. It serves `/token`, `/register`, and the metadata documents. It stores grants in the KV binding `OAUTH_KV`.

### `@modelcontextprotocol/server` 2.3.1

A dependency. It gives `McpServer`, which registers the tool `mint_upload_url`. Version 2.3.1 is the exact version that `agents` 0.29.0 requires as a peer.

### `zod` 4.6.7

A dependency. The tool input schema uses `z.object`. `agents` 0.29.0 requires `zod` as a peer, and `@modelcontextprotocol/server` 2.3.1 depends on it. The prompt does not name it.

### `miniflare` 4.20260730.0

A dev dependency. It is the official local runtime for Workers. The integration tests load the dry-run bundle in it with in-memory R2 and KV.

### `@modelcontextprotocol/sdk` 1.32.1 and `@modelcontextprotocol/client` 2.3.1

Not in `package.json`. They are in `pnpm-lock.yaml` only. `agents` 0.29.0 lists both as required peers, so pnpm resolves them. The Worker does not import them.

## Design decisions

### The `packageManager` pin

`package.json` sets `packageManager` to `pnpm@10.34.0`. pnpm 10 and later switch to that version before they install. pnpm 9 switches only with `manage-package-manager-versions=true`.

### One provider for each origin

`OAuthProvider` requires `resourceMetadata.resource`, an absolute URL on the origin of the Worker. The Worker does not know its origin at module scope. So `src/worker.mjs` makes one provider for each origin from `new URL(request.url).origin` and keeps it in a `Map`.

### The Access identity through `ctx.access`

`/authorize` reads the identity with `ctx.access.getIdentity()`. The Worker does not check the `Cf-Access-Jwt-Assertion` JWT itself. A Cloudflare Access application protects only `/authorize`. If `ctx.access` is absent, `/authorize` returns 403.

### One email rule in `src/email.mjs`

`/authorize` and the tool use the same function, `isAllowedEmail`. It trims both values and then requires an exact, case-sensitive match. An empty `ALLOWED_EMAIL` matches no email. The module imports nothing, so plain Node can load it in the tests.

### The redirect URI allow list in the registration callback

The OAuth library has no redirect URI allow list. `clientRegistrationCallback` accepts a registration only when each redirect URI is one of the two claude.ai and claude.com callbacks. It rejects all other registrations with `invalid_redirect_uri`.

### The `test` script

The `test` script is `pnpm run dry-run && node --test 'test/**/*.test.mjs'`. The dry run must come first, because Miniflare loads `dist/worker/worker.js`. Node 24 rejects the bare directory argument `node --test test/`.

### The compatibility date

`wrangler.jsonc` sets `compatibility_date` to `2026-07-30` and the flag `nodejs_compat`. `miniflare` 4.20260730.0 bundles workerd 1.20260730.1, so a later date does not run in the tests. `agents/mcp/server` imports `node:async_hooks`, which needs `nodejs_compat`.

### No consent page on `/authorize`

`/authorize` shows no consent page. The Access login of the owner is the consent. The owner accepts this risk:

- An attacker with a claude.ai account can send the owner an authorize link.
- If claude.ai accepts the callback by `state` alone, the connector of the attacker gets a token with the email of the owner.
- This claude.ai behavior is UNVERIFIED.
- If a fix is necessary, it is `beginConsent` and `approveConsent` from the OAuth library.

SETUP.md step 7 tells the owner to open an authorize link only from their own connector setup.

### No PAX and a 100-byte path limit

`tar.mjs` writes plain USTAR headers. It writes no PAX header and does not split a path into `prefix`. A path longer than 100 bytes in UTF-8 stops the bundle with an error that names the path.

### JSON success bodies and one-line failure bodies

A stored upload returns 201 and a repeat upload returns 200. Each success body is JSON `{ "key": "<key>" }` with `Content-Type: application/json`. Each failure body is one `text/plain` line in the form `not saved: <reason>. fix: <fix>`.

## Differences from the prompt

The design lists these 13 differences:

1. Section 4: "stop when the docs disagree" becomes "record and continue".
2. Section 5: `zod` 4.6.7 is added, because `agents` and `@modelcontextprotocol/server` require it and the tool schema imports it.
3. Section 5: `@modelcontextprotocol/sdk` 1.32.1 and `@modelcontextprotocol/client` 2.3.1 are in the lockfile as peers of `agents`. The Worker does not import them.
4. Section 9: `resourceMetadata: { resource: "<origin>/mcp" }` is a required option, so the Worker makes one provider for each origin.
5. Section 9: the options `authorizeEndpoint: "/authorize"`, `tokenEndpoint: "/token"`, and `clientRegistrationEndpoint: "/register"` are added.
6. Section 9: the MCP server factory gets no `env`, so `createMcpHandler` is called inside `apiHandler.fetch`.
7. Section 9: the redirect URI allow list is in `clientRegistrationCallback`.
8. Section 9: the Worker reads the Access identity through `ctx.access.getIdentity()`, not through a JWT check.
9. Section 11: the `test` script is `pnpm run dry-run && node --test 'test/**/*.test.mjs'`.
10. Section 12: `wrangler.jsonc` sets `compatibility_date: "2026-07-30"` and `compatibility_flags: ["nodejs_compat"]`.
11. Section 2: a conflict between the prompt and the principles goes under QUESTIONS in the build result, and the build continues.
12. Section 13: the run opens one pull request from branch `1/save-it` to `main` as its delivery.
13. Verdict file, Task 2 checkpoint: the supervisor reads the build 2 result, and the owner is not asked.

The builds added these differences from the design:

14. `bundle.mjs` runs its CLI when `realpathSync(process.argv[1])` equals the real path of the module. The design form fails when the script runs through a symbolic link.
15. `buildManifest` takes `(files, { date, source, topic })`, not `(files)`. The manifest must carry the three fields, and `files` does not hold them.
