# wh1teee-org Renovate policy

This public repository contains the shared, versioned dependency-update policy
for selected `wh1teee-org` repositories. It contains no credentials and is kept
public so the Renovate app does not need write access to the policy repository.

## Consumer configuration

Node/pnpm repositories extend the common and Node presets:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": [
    "github>wh1teee-org/renovate-config",
    "github>wh1teee-org/renovate-config:node",
    "github>wh1teee-org/renovate-config:pnpm"
  ]
}
```

The Konergy preset is deliberately disabled and must not be onboarded yet. Its
root `pnpm-lock.yaml` is shared with the immutable `packages/llm` workspace, so
Konergy CI must first compare the current canonical projection of that importer
and every transitively reachable package/snapshot node with the merge-base from
`origin/master`. The guard must live outside and never enter `packages/llm/**`;
the protected base revision, not a PR-authored file, is the baseline. The
accepted implementation is
`scripts/ci/verify-llm-lock-boundary.mjs`, exposed as
`pnpm test:llm-lock-boundary` and required by `.github/workflows/turbo-ci.yml`.
Once the PR containing that green required check is merged, a reviewed policy
change may enable the preset; Konergy then extends the common, `node`, and
`konergy` presets but not `pnpm`, keeping lockfile maintenance and dedupe
disabled and every update human-merged. AthleteOS extends the common and
`athleteos` presets; that preset enables only its Python, uv, Gradle, Docker,
and GitHub Actions managers and intentionally excludes npm.

The Mend Renovate GitHub app must use **Selected repositories** and include
only `PayAtTable`, `ride-os`, and `athleteos` initially. Add `konergy` only after
the lockfile-closure CI guard above is merged and the disabled preset is enabled
in a reviewed change. The protected personal `vpn-subscription-service`
repository is never installed or onboarded.

## Repository contents

- `default.json` contains the common scheduling, pinning, review, and automerge
  policy.
- `node.json`, `pnpm.json`, `konergy.json`, and `athleteos.json` are composable
  ecosystem/repository presets; `konergy.json` is currently disabled.
- `.github/workflows/validate.yml` validates the presets; the permanent,
  no-action `.github/workflows/jit-runner-smoke.yml` validates JIT admission.
- `.github/actionlint.yaml` declares the three custom self-hosted runner labels.
- `scripts/test-presets.mjs` checks static fleet invariants, while
  `scripts/test-jit-runner-smoke.mjs` locks down the JIT workflow contract.
- `scripts/test-renovate-fixture.mjs` runs exact-pinned Node, npm, and Renovate,
  uses Renovate's own config merge and package-rule pipeline, and separately
  proves an incompatible peer graph is rejected by npm's strict resolver.
- `test/fixtures/` contains the checked-in extraction and peer-conflict inputs.

Residual onboarding prerequisites are repository transfer to `wh1teee-org`,
green consumer CI, and selected-repository GitHub app installation. Konergy also
requires the lockfile-closure guard above. None of these presets authorizes a
change to `vpn-subscription-service`.

The JIT smoke workflow targets only the exact `work-pc` general labels for this
repository and rejects forks and non-owner actors before runner assignment. It
checks GitHub-provided runner identity, requires both workspace and temp paths
beneath the isolated per-job root, probes shared caches read-only, and writes a
harmless marker beneath `RUNNER_TEMP`. Because `pull_request` evaluates the
PR-head workflow, host admission must independently allowlist the exact reviewed
run and head SHA before creating its one-job JIT runner. Post-job proof must show
the runner auto-deregistered and both the marker and job root were deleted. The
workflow uses no secrets, checkout, or action.

## Policy

- Direct dependency declarations and container/action references are pinned.
- Renovate does not update the Corepack `packageManager` field because upstream
  issue [renovatebot/renovate#37772](https://github.com/renovatebot/renovate/issues/37772)
  still drops its `+sha512` integrity. pnpm version and integrity move together
  only in reviewed toolchain PRs; the setup action remains independently managed.
- pnpm catalogs stay repo-local; Renovate updates them through the npm manager
  and runs `pnpmDedupe` after lockfile changes.
- TypeScript's TS6 compiler-API alias and TS7 native typecheck alias are separate
  approval lanes.
- Compatibility families are grouped; majors, native ABI packages, database,
  auth, and security-sensitive changes remain reviewed.
- Only mature dev-only patch updates may automerge, after seven release days and
  required checks pass. They always merge through a PR and never use GitHub's
  platform-native automerge. All other updates remain human-merged; Konergy
  remains entirely disabled until its lockfile-closure invariant is enforced
  in repository CI.
- Branch creation is limited to Minsk nights/weekends. Two commits per hour per
  repository prevents rebase storms while host admission controls actual runner
  capacity.

## Validation and rollback

Run:

```sh
node scripts/test-presets.mjs
node scripts/test-jit-runner-smoke.mjs
npm exec --yes --package=renovate@43.263.7 -- renovate-config-validator --strict --no-global default.json node.json pnpm.json konergy.json athleteos.json
node scripts/test-renovate-fixture.mjs
actionlint .github/workflows/jit-runner-smoke.yml .github/workflows/validate.yml
```

Rollback is additive and reversible: remove the consumer `renovate.json`, or
remove that repository from the GitHub app's selected-repository list. Existing
Renovate PRs can then be closed without changing source dependencies.
Shared Renovate presets for wh1teee-org repositories
