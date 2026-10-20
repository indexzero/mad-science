---
title: "save-it setup"
status: "built, not deployed"
project: save-it
stage: 1
source_prompt: PROMPT.md
design: "TECHNICAL.DESIGN.md in the orckits run home indexzero/mad-science/2026-10-save-it/"
---

# save-it setup

Do these nine steps one time, in this order. Run each command from `stage/1/save-it/`. Run `pnpm install` first.

The steps use `<worker-host>` for the host of the Worker. On `workers.dev`, the host is `save-it.<account-subdomain>.workers.dev`. To find `<account-subdomain>`, open the Cloudflare dashboard and go to Workers & Pages. The subdomain is on the Overview page.

## 1. Create the R2 bucket

Run this command:

```sh
pnpm wrangler r2 bucket create save-it-bundles
```

The binding `BUNDLES` in `wrangler.jsonc` already names `save-it-bundles`. Do not change it.

## 2. Create the KV namespace

Run this command:

```sh
pnpm wrangler kv namespace create save-it-oauth
```

The command prints an `id` of 32 hexadecimal characters. Copy it. In `wrangler.jsonc`, replace the placeholder id in `kv_namespaces[0].id` with the value you copied:

```jsonc
"kv_namespaces": [
  { "binding": "OAUTH_KV", "id": "<the id from the command>" }
],
```

Keep the binding name `OAUTH_KV`.

## 3. Set the secret `UPLOAD_SIGNING_KEY`

Make 32 random bytes in hex:

```sh
openssl rand -hex 32
```

Copy the 64 characters that the command prints. Then run this command and paste the value at the prompt:

```sh
pnpm wrangler secret put UPLOAD_SIGNING_KEY
```

If wrangler asks to create the Worker `save-it`, answer yes. Do not write the value in a file. Do not put it in `wrangler.jsonc` or in the skill. If the secret is missing or shorter than 32 bytes, the Worker refuses every upload.

## 4. Set the variable `ALLOWED_EMAIL`

In `wrangler.jsonc`, replace `owner@example.com` with the one email that you use to sign in to Cloudflare Access:

```jsonc
"vars": {
  "ALLOWED_EMAIL": "<your email>",
  "MAX_BYTES": "52428800",
  "UPLOAD_TTL_SECONDS": "60"
}
```

Do this before step 6. `wrangler deploy` writes the `vars` of `wrangler.jsonc` to the Worker. Do not commit this change.

## 5. Configure Cloudflare Access

1. In the Cloudflare dashboard, open Zero Trust. If Zero Trust is not enabled, enable it on the free plan.
2. Go to Access controls, then Applications. Select Add an application, then Self-hosted.
3. Give the application the name `save-it authorize`.
4. Add one public hostname: the domain `<worker-host>` with the path `authorize`.
5. Add one policy. Set the action to Allow. Add one include rule with the Emails selector and your email from step 4.
6. Save the application.

Protect only the path `/authorize`. Do not protect `/mcp`, `/u/`, or `/health`. OAuth protects `/mcp`. The signed token protects `/u/`.

If the dashboard refuses a path on a `workers.dev` hostname, add a Custom Domain to the Worker first. In the Worker, go to Settings, then Domains & Routes, then Add, then Custom Domain. Use that domain as `<worker-host>` in this step and in the steps that follow.

## 6. Deploy with `pnpm run deploy`

Run this command:

```sh
pnpm run deploy
```

The command prints the URL of the Worker. Write down its host as `<worker-host>`. Then make sure that the Worker answers:

```sh
curl https://<worker-host>/health
```

The answer must be `ok`.

## 7. Add the connector in claude.ai on the web

1. In claude.ai on the web, open Settings, then Connectors.
2. Select Add custom connector.
3. Set the name to `save-it`. Set the URL to `https://<worker-host>/mcp`.
4. Select Add, then Connect.
5. When the browser asks, sign in to Cloudflare Access with your email.

The browser goes through Access on `/authorize`, and claude.ai gets a token. The Android app can use the connector, but it cannot add the connector.

Open an authorize link only from your own claude.ai connector setup. Do not open an authorize link that another person sends you.

## 8. Turn on network access for code execution

1. In claude.ai, open Settings, then Capabilities.
2. Turn on code execution and file creation.
3. Turn on network access for code execution.
4. Add `<worker-host>` to the allowed domains.

## 9. Upload the skill

Run this command with your Worker host:

```sh
pnpm skill:pack <worker-host>
```

The command writes the host into line 1 of `skill/save-it/scripts/bundle.mjs` and makes `dist/save-it.zip`. In claude.ai, open Settings, then Capabilities, then Skills. Upload `dist/save-it.zip`.

Do not commit the changed `bundle.mjs`. To restore the committed value, run `pnpm skill:pack example.invalid`.

## After setup

In a claude.ai chat, say "save it". The answer is one line, `saved: <key>` or `not saved: <reason>. fix: <fix>`.
