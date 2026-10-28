# seedpod

**seedpod** is a set of GitHub Actions that publishes runtime binaries to a
`pear://` drive from a GitHub Release.

Each Release is the binary's trust anchor. The drive carries the exact source
coordinates — a `git` URI with the commit sha — so a consumer can check what
they received against the Release that authorized it.

Use seedpod if you publish Pear binaries from CI and do not want the drive's
write key living in a job that runs your project code. If you do not publish to
Pear, this is not for you.

## Why it exists

The documented Pear CI path holds three risks in one job. It grants `contents:
write`. It commits generated state back to `main`. It puts the drive's write key
in the same job that runs your code. That is the colocated-authority shape
behind the TanStack compromise; `docs/THREAT.MODEL.md` traces the chain.

seedpod removes the shape by removing its cause: no state flows backward into
git. Pear staging needs two persistent things — a 32-byte Corestore identity key
and an incremental-sync snapshot. Neither needs to live in the repo. The key
lives in a protection-ruled GitHub Environment, read only by a job that never
runs your code. The snapshot rides the Release as an asset. With no state going
back to git, the repo-write permission disappears, and authority splits per job
so that **no job holds both repo-write (`contents: write`) and drive-write (the
primary key)**.

It is one release-triggered workflow. Its seven jobs form two authority planes.

The **build plane** checks out the tag's resolved commit under `contents: read`
with no publish secrets. It produces the per-host binaries, a `SHA256SUMS`, and
`seedpod.json`, covers them all with a sigstore attestation, and hands them to a
code-free job that attaches them to the Release.

The **seed plane** never checks out your code. It downloads those assets back
off the Release, verifies each against the attestation with a pinned signer
identity, and assembles the `by-arch/<host>/app/<name>` layout. It stages the
drive with the pinned `pear-ci` tool and the Environment-scoped key. `pear-ci`
derives the same `pear://` link from the key and namespace on every run, so the
drive is stable across releases. A separate code-free, key-free job then attaches
the refreshed snapshot to the Release.

`docs/THREAT.MODEL.md` maps each hazard to its control; `docs/TRUST.ANCHORS.md`
gives the schema and the consumer verify commands.

## The trust story, in one sentence

> The drive tells you its git sha and its Release; the attestation binds both;
> go check.

## Consumer quickstart

1. **Create the `pear-publish` Environment** in your repo with the
   `PEAR_PRIMARY_KEY` secret (64 hex chars) and a deployment policy restricting
   it to `v*` tags. See [`docs/OPERATIONS.md`](docs/OPERATIONS.md).
2. **Add the release workflow.** Copy [`examples/consumer-release.yml`](examples/consumer-release.yml)
   to `.github/workflows/release.yml` and set `name:` / `entrypoint:`.
3. **Publish a Release** with a human account, a PAT, or a GitHub App — the
   default `GITHUB_TOKEN` does **not** fire `release:` workflows.
4. **Consumers install** the drive with `npx pear-install pear://<key>` (Pear v3
   CLI also exposes it as `pear install`), and can independently verify what
   they received — the commands are in [`docs/TRUST.ANCHORS.md`](docs/TRUST.ANCHORS.md).

## Layout

```
seedpod/
  README.md                    this file
  docs/
    THREAT.MODEL.md            hazards ⇄ controls, incl. residual risks
    TRUST.ANCHORS.md           Release⇔version⇔drive mapping; seedpod.json; verify commands
    OPERATIONS.md              key ceremony, Environment setup, seeder infra, previous-release rule
  actions/
    build-binaries/action.yml  composite — build one host binary
    release-assets/action.yml  composite — the ONLY steps under contents:write
    pear-publish/action.yml    composite — stage only; emits snapshot; NO upload
  workflows/
    release.yml                the single reusable workflow (release + workflow_call)
    lint.yml                   actionlint + zizmor over the workflow files (PR-triggered)
  examples/
    consumer-release.yml       what a consuming repo pastes
```

## Pin conventions

- **Third-party actions** are SHA-pinned with a trailing `# vX.Y.Z` comment,
  e.g. `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2`. A
  rewritten tag cannot move a pinned consumer; Dependabot/Renovate maintain the
  single pin.
- **seedpod's own actions and workflow** are referenced as
  `OWNER/seedpod/actions/<name>@SEEDPOD_PIN_SHA # seedpod vv0.1.0` (and
  `OWNER/seedpod/.github/workflows/release.yml@SEEDPOD_PIN_SHA` for the reusable
  workflow). `OWNER` and `SEEDPOD_PIN_SHA` are **named placeholders**: the
  standalone `OWNER/seedpod` repository does not exist yet. When it is cut,
  replace `OWNER` with the org and
  `SEEDPOD_PIN_SHA` with the release commit sha, keeping the `# seedpod vv0.1.0`
  comment. Reusable workflows must live under `.github/workflows/` in that repo
  — the files here under `workflows/` are the reference sources for that path.
- **Top-level `permissions: {}`** on every workflow; each job re-grants exactly
  what it needs. `persist-credentials: false` on every checkout. `harden-runner`
  egress is `block` + allow-list everywhere except the P2P `stage` job, which
  must run `audit` (see THREAT.MODEL.md § residual risks).
