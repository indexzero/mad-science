# seedpod — Threat Model

Every hazard below is drawn from a verified failure mode. Two supplied them: the
documented holepunch `pear-ci` flow (fetched 2026-07-30), and the TanStack
supply-chain compromise (fork PR → `pull_request_target` → Actions-cache
poisoning → OIDC exfiltration → 84 malicious versions across 42 packages; "no
zero-days").

The controls live in `workflows/release.yml` and the `actions/` composites.
Where seedpod is knowingly weaker, it says so under **Residual risks** rather
than hiding it.

## Hazards ⇄ controls

| # | Hazard (observed failure mode) | Control in seedpod | Where |
|---|---|---|---|
| H-1 | CI holds `contents: write` back to the repo and commits generated state (`ci/snapshot.json`) to `main` on every push | No job commits to any branch. The snapshot is a Release asset produced by `stage` and attached by a code-free job. The only `contents: write` jobs (`upload`, `snapshot-upload`) check out nothing and run no project code. | `release.yml` jobs `upload`, `snapshot-upload`; `stage` produces `snapshot.json` |
| H-2 | Drive write key is an ordinary repo secret available to the job that runs project code | `PEAR_PRIMARY_KEY` exists ONLY in the `pear-publish` Environment, consumed ONLY by `stage`, which never holds `contents: write` and never checks out project code. No job holds both repo-write and drive-write. | `release.yml` `stage` (`environment: pear-publish`); `pear-publish` composite |
| H-3 | Action referenced by a moving ref (`@main`) can rewrite what CI runs | Every `uses:` is SHA-pinned with a `# vX.Y.Z` comment; seedpod's own refs use the `SEEDPOD_PIN_SHA` placeholder pending the standalone repo. `lint.yml` (zizmor) gates new unpinned refs. | all workflows/actions; `lint.yml` |
| H-4 | `pull_request_target` / fork triggers run privileged with attacker code | Only triggers are `release: {types:[published]}` and `workflow_call`. No `pull_request_target`, no `workflow_run`. | `release.yml` `on:` |
| H-5 | Actions-cache poisoning carries a malicious payload into a trusted job | No `actions/cache` in any publish-bearing job; artifacts pass between jobs via `upload-artifact`/`download-artifact` only, and every asset is re-verified against the attestation before it can enter the drive. | `release.yml` `stage` verify step |
| H-6 | Template injection: attacker-influenced values (`tag_name`, release body, repo name) interpolated into `run:` | All attacker-influenceable values enter `run:` via `env:` only, never `${{ }}` inside the script (TanStack lockdown #3). | every `run:` in `release.yml` |
| H-7 | Checkout of the wrong commit — `target_commitish` is a branch that can move after the tag | `resolve` resolves the **tag's** commit (dereferencing annotated tags); `build` checks out that sha and asserts `git rev-parse HEAD` equals it, failing closed on drift. | `release.yml` `resolve`, `build` |
| H-8 | A swapped Release asset (GitHub does not enforce asset immutability) serves poisoned bytes | Release assets are transport, not the integrity root. The sigstore attestation (public, append-only, outside the repo) covers every binary + `SHA256SUMS` + `seedpod.json`; `stage` verifies each asset with a pinned `--repo` + `--signer-workflow` predicate before use. | `release.yml` `attest`, `stage` |
| H-9 | Leaked checkout credentials in the workspace | `persist-credentials: false` on the one checkout (`build`); no other job checks out project code. | `release.yml` `build` |
| H-10 | Runner exfiltrates secrets to an arbitrary endpoint | `harden-runner` `egress-policy: block` + allow-list on every job except `stage` (see R-2). | every job |
| H-11 | Over-broad `GITHUB_TOKEN` | Top-level `permissions: {}`; each job re-grants the minimum (`contents: read`, or `id-token`/`attestations: write` only where attesting, or `contents: write` only on the two code-free upload jobs). | `release.yml` |

## TanStack lockdown coverage

Each lockdown from the post-mortem mapped to its implementing control:

| Lockdown | Control |
|---|---|
| SHA-pin every action | H-3 |
| Least privilege / no ambient write | H-1, H-11 |
| No `${{ }}` of untrusted input in `run:` | H-6 |
| `persist-credentials: false` | H-9 |
| Split build from publish authority | H-1, H-2 |
| zizmor + actionlint on workflow changes | `lint.yml` |
| Pinned-update automation | Dependabot/Renovate on the single pin (README § Pin conventions) |
| Cache isolation | H-5 |
| No `pull_request_target` / `workflow_run` | H-4 |

## Residual risks (named, not hidden)

- **RR-1 — Asset upload requires `contents: write`.** GitHub has no assets-only
  scope, so `upload` and `snapshot-upload` must hold `contents: write`. Mitigated,
  not eliminated: both are **code-free by contract** — no project checkout, no
  package-manager install, a single pinned `gh release upload` via the
  `release-assets` composite; the contract is enforceable by review and by the
  `lint.yml` zizmor gate. The requirement's substance — no CI *commits back to
  the repository* — is preserved.
- **RR-2 — `stage` egress cannot be allow-listed.** `pear-ci` replicates to the
  hyperswarm DHT (arbitrary UDP peers), so `stage` runs `egress-policy: audit`,
  not `block`. The seed plane's ONE install is the single **version-pinned
  `pear-ci` npm tool** (`pear-ci@0.1.1`), fetched from the npm registry
  (`registry.npmjs.org`, allow-listed) *before* the DHT phase — pinned tooling,
  not floating latest, and no project code is checked out and no project or
  transitive dependencies are installed. Compensating controls: that
  pinned-tool-only install, the key scoped to the Environment, and the
  harden-runner audit log retained as a run artifact (`stage-egress-audit`,
  `if-no-files-found: warn` so an empty capture is loud, not silent).
 
- **RR-3 — Snapshot round-trip is unverified.** Whether `pear-ci`'s incremental
  `--snapshot` resumes correctly across a fresh corestore is UNVERIFIED at design
  time. It **fails closed**: a missing or incompatible `snapshot.json` degrades
  to a full re-stage (proportional to total drive bytes), never to a wrong or
  partial drive. First release always takes the genesis path.
- **RR-4 — `pear-ci` CLI surface is unverified.** Two `pear-ci` behaviours are
  taken from its docs, not empirically confirmed at design time: (a) the exact
  stdout line the `pear-link` is scraped from (`starting stage for key
  <drive-key>`), and (b) the cold-start shape of `--storage`/`--snapshot` from an
  empty corestore. Both **fail closed** in `pear-publish`: a mis-scraped or absent
  key aborts the step (the drive link never silently becomes empty/wrong), and an
  absent/incompatible snapshot restages fully (RR-3). The pinned `pear-ci@0.1.1`
  version freezes this surface until a deliberate bump re-verifies it.
 
