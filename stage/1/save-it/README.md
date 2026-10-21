---
title: "save-it"
status: "built, not deployed"
project: save-it
stage: 1
source_prompt: PROMPT.md
design: "TECHNICAL.DESIGN.md in the orckits run home indexzero/mad-science/2026-10-save-it/"
---

# save-it

save-it saves one claude.ai chat as one `.tgz` bundle in one R2 bucket. The user says "save it", and the bundle holds the chat inputs, the outputs, a reconstructed transcript, and a manifest. One line comes back: `saved: <key>` or `not saved: <reason>. fix: <fix>`.

## How it works

The tool is `mint_upload_url(date, source, topic, sha256, size)` at `/mcp`. OAuth protects it. The Worker validates each argument, and an error names the field. Then the Worker composes the object key from the fields. The Worker never parses a key.

The token binds the key, the sha256, the size, and an expiry. The Worker signs it with HMAC-SHA256 through Web Crypto and the secret `UPLOAD_SIGNING_KEY`. The Worker stores no token. The upload URL is `https://<worker-host>/u/<token>`.

The route `PUT /u/<token>` verifies the token and the `Content-Length`. Then it streams the body into R2 with the sha256 checksum. R2 rejects bytes that do not match. A second upload of a stored key returns 200 and writes nothing. `GET /health` answers `ok`. `GET /authorize` reads the Cloudflare Access identity and completes the OAuth grant for the one allowed email.

The skill `save-it` runs in the claude.ai code execution sandbox. Its script `bundle.mjs` collects the files, writes the manifest, and makes a deterministic `.tgz`. Then the skill calls the tool and uploads the bundle with `curl -T`.

## Commands

Run each command from this directory.

| Command | What it does |
|---|---|
| `pnpm install` | installs the pinned packages |
| `pnpm test` | runs the dry run, then every test under `node --test` |
| `pnpm dry-run` | runs `wrangler deploy --dry-run --outdir dist/worker` and deploys nothing |
| `pnpm skill:pack <host>` | writes the host into `bundle.mjs` and makes `dist/save-it.zip` |
| `bash check.sh` | runs install, test, dry run, and pack, and checks the zip root |

The `deploy` script is for the owner at SETUP.md step 6. The checks do not run it.

## Layout

```
stage/1/save-it/
  .gitignore                        node_modules/, dist/, .tmp/
  package.json                      the pinned packages and the scripts
  pnpm-lock.yaml
  wrangler.jsonc                    the bindings and the vars, with placeholders
  check.sh                          the machine-checkable Done
  pack.mjs                          pnpm skill:pack <host>
  README.md
  SETUP.md                          the nine one-time setup steps
  DECISIONS.md                      the packages, the decisions, the differences from the prompt
  PROMPT.md                         the source prompt
  src/worker.mjs                    the fetch export, the OAuth provider, the routes
  src/key.mjs                       validate and compose
  src/token.mjs                     sign and verify
  src/tool.mjs                      createServer and mintUploadUrl
  src/email.mjs                     the one email rule
  skill/save-it/SKILL.md            the skill steps
  skill/save-it/scripts/bundle.mjs  builds the bundle
  skill/save-it/scripts/tar.mjs     the deterministic USTAR writer and gzip
  test/key.test.mjs
  test/token.test.mjs
  test/email.test.mjs
  test/tar.test.mjs
  test/manifest.test.mjs
  test/tool.test.mjs
  test/worker.test.mjs              Miniflare on the dry-run bundle
  dist/                             ignored: worker/ and save-it.zip
  node_modules/                     ignored
```

## Key grammar

The key is `{date}-{source}-{topic}-{sha256}.tgz`. The key has no leading slash. The alphabet is `a-z`, `0-9`, and `-`. The only `.` is before `tgz`.

| Field | Regex | Limits | Error message |
|---|---|---|---|
| `date` | `^\d{4}-\d{2}-\d{2}$` | a real UTC calendar date, not more than one day before or after the Worker UTC date | `date: must be YYYY-MM-DD, a real calendar date, not more than one day from the Worker UTC date` |
| `source` | `^(claude-mobile\|claude-web\|claude-code)$` | one of three values | `source: must be one of claude-mobile, claude-web, claude-code` |
| `topic` | `^[a-z0-9]+(-[a-z0-9]+)*$` | 1 to 32 characters | `topic: must match ^[a-z0-9]+(-[a-z0-9]+)*$ and have 32 characters at most` |
| `sha256` | `^[0-9a-f]{64}$` | 64 lowercase hex characters | `sha256: must be 64 lowercase hexadecimal characters` |
| `size` | integer | 1 to `MAX_BYTES` (default 52428800) | `size: must be a positive integer not more than <MAX_BYTES>` |

Example:

```
date   2026-09-26
source claude-mobile
topic  3coin-in-3d
sha256 a9b7df43aa05a12f3f7c4265fd61a8d50029c3a2a28a12f231bad480747cc8ab
size   480981
key    2026-09-26-claude-mobile-3coin-in-3d-a9b7df43aa05a12f3f7c4265fd61a8d50029c3a2a28a12f231bad480747cc8ab.tgz
```

## Limits

- `MAX_BYTES` is the largest bundle in bytes. The default is 52428800 (50 MiB).
- `UPLOAD_TTL_SECONDS` is the token lifetime. The default is 60 seconds.
- One user. `ALLOWED_EMAIL` holds one address.
- The system does not list, read, or unpack the bucket.
- The skill has no bundle script for Claude Code. `claude-code` is a valid `source` value only.
