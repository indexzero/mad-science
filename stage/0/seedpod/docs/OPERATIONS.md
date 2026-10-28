# seedpod — Operations

Operator-facing setup and standing procedures. Everything CI needs beyond the
YAML lives here: the key ceremony, the Environment, the always-on seeder, the
release-actor precondition, and the previous-release selection rule.

## Release-actor precondition

`release: {types:[published]}` does **NOT** fire for Releases created with the
default `GITHUB_TOKEN`. Publish Releases with a **human account, a PAT, or a
GitHub App** (verified 2026-07-30). A Release created by a bot using the default
token will silently never trigger seedpod.

## The `pear-publish` Environment

The drive's primary key lives in exactly one place: a GitHub **Environment**
named `pear-publish`, consumed only by the `stage` job (which declares
`environment: pear-publish` and never holds `contents: write`). Environment
secrets are resolved in the repo where the run happens, so for reusable-call
adoption the Environment must exist in the **consumer's** repo, not seedpod's.

Setup (Settings → Environments → New environment → `pear-publish`):

1. **Secret** `PEAR_PRIMARY_KEY` — the 64-hex Corestore identity key (see Key
   ceremony). This is the drive's writer identity; treat it like a signing key.
2. **Deployment branches and tags policy** — restrict to **Selected refs** and
   add the tag pattern `v*`. This is the tag-ref deployment policy: only runs
   whose ref is a `v*` tag may access the key, so a run off a branch or a
   non-`v` tag cannot stage the production drive.
3. **Required reviewers** — OPTIONAL, per repo policy. seedpod works both ways:
   - *Unattended:* no reviewers — every qualifying Release stages automatically.
   - *Human-gated:* add reviewers — `stage` pauses for approval before the key
     is exposed. Recommended for the first production drive and for key rotation.

### Passing the key: in-tree vs reusable-call

Whichever adoption mode, the key still lands in exactly one job (`stage`, which
alone declares `environment: pear-publish`). What differs is how it gets there:

- **In-tree adoption** (you copied `release.yml` into your own
  `.github/workflows/`): the run happens directly on the `release` trigger in your
  repo, so `secrets.PEAR_PRIMARY_KEY` in the `stage` job resolves the Environment
  secret directly. Nothing extra to pass.
- **Reusable-call adoption** (you `uses:` seedpod's reusable workflow): a GitHub
  `environment:` binds env-scoped **vars** into a called reusable workflow but
  **NOT** env-scoped **secrets** (verified 2026-07-30). The caller MUST forward
  the key or `stage` reads an empty string. seedpod declares it as a required
  `workflow_call` secret (`on: workflow_call: secrets: PEAR_PRIMARY_KEY:
  {required: true}`); the consumer passes it with `secrets: inherit` — or
  explicitly `secrets: { PEAR_PRIMARY_KEY: ${{ secrets.PEAR_PRIMARY_KEY }} }`.
  See [`examples/consumer-release.yml`](../examples/consumer-release.yml).

Either way it **fails closed**: an empty key is rejected by the `pear-publish`
hex validator, so a mis-wired call never stages the wrong drive — it fails loud.
`secrets: inherit` forwards the caller's secrets only to seedpod's jobs; the key
still reaches only `stage`, never a build-plane or upload job.

## Key ceremony

- **Minting.** The primary key is a 32-byte Corestore identity — 64 hex
  characters of cryptographic randomness (e.g. `openssl rand -hex 32`). Generate
  it once and store it ONLY as the `pear-publish` Environment secret; it must
  never be committed, never be a plain repo secret, and never appear in a
  build-plane job. The `pear://` link is NOT minted separately — `pear-ci`
  derives it deterministically from this key + the drive `namespace` (`--name`)
  on every run, which is exactly what makes the Release⇔drive mapping 1-to-1.
- **Rotation.** Rotating the key means a **new drive** (new public key ⇒ new
  `pear://` link). There is no in-place rotation of a drive's writer identity.
  Ceremony:
  1. Mint a new primary key; update the `pear-publish` Environment secret.
  2. Cut a Release; `stage` produces a fresh genesis drive under the new link.
  3. Publish the new `pear://<key>` in the Release notes and announce it — every
     consumer must **re-anchor** (`npx pear-install pear://<new-key>`). Old
     drive keeps serving the old bytes until you tear the seeder down.
- **Compromise.** Treat a leaked primary key as a compromised drive: rotate as
  above and revoke trust in the old link via a Release note. The attestation
  store is unaffected (it is not signed with this key) — prior releases remain
  independently verifiable.

## Seeder infrastructure (durable availability)

CI runners are ephemeral: `pear-ci` stages (writes) the drive, but a drive is
only reachably served while a peer holding it is online. seedpod's actions end at
**staged-and-announced**; durable availability is operator infrastructure, not a
CI job.

- Run at least one **always-on seeder peer** (`pear seed pear://<key>`, or an
  equivalent long-lived Pear peer) on infrastructure you control.
- This peer needs only the **public** drive key, never the primary key — seeding
  is read/replicate, not write. Keep it strictly separate from the key ceremony.
- This is a standing requirement of Pear's model regardless of CI design; it
  adds no service beyond what Pear already needs, and removes the perpetual
  snapshot-commit noise on `main` that the documented `pear-ci` flow produces.

## Previous-release selection rule

The `stage` job resumes incremental staging from the previous release's
`snapshot.json`. "Previous release" is defined precisely:

> The **highest semver-ordered, non-draft, non-prerelease** release **strictly
> below** the current tag. If none exists (or it carries no `snapshot.json`),
> take the **genesis** path — stage from empty.

The `stage` job's `Select previous release snapshot` step implements this in
four moves. It lists releases via the API, filtered to `draft == false and
prerelease == false`. It drops the current tag. It keeps only tags that sort
strictly below the current tag under `sort -V` (semver order). It picks the
greatest of those.

Skipping drafts and prereleases has two consequences worth stating. A
`v1.3.0-rc.1` never seeds `v1.3.0`. And a hotfix `v1.2.4` published after
`v1.3.0` resumes from `v1.2.3` — the highest release below it — not from
`v1.3.0`.

This **fails safe** either way: a missing previous release, a missing
`snapshot.json`, or an incompatible snapshot all degrade to a full re-stage
(RR-3), never to a wrong drive. The first release always takes genesis.

## Standing controls checklist

- Top-level `permissions: {}`; per-job least privilege.
- Every `uses:` SHA-pinned with a `# vX.Y.Z` comment; seedpod's own refs use the
  `SEEDPOD_PIN_SHA` placeholder until the standalone repo is cut.
- `persist-credentials: false` on the one checkout (`build`).
- `harden-runner` `block` + allow-list everywhere except `stage` (`audit`, RR-2).
- `lint.yml` runs actionlint + zizmor on every change under `workflows/`,
  `actions/`, or `examples/`.
