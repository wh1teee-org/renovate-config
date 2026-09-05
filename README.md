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

Konergy's root `pnpm-lock.yaml` is shared with the immutable `packages/llm`
workspace. Its repository CI therefore compares the canonical projection of
that importer and every transitively reachable package/snapshot node with the
merge-base from `origin/master`. The guard lives outside and never enters
`packages/llm/**`; the protected base revision, not a PR-authored file, is the
baseline. The accepted implementation,
`scripts/ci/verify-llm-lock-boundary.mjs`, is exposed as
`pnpm test:llm-lock-boundary` and runs in `.github/workflows/turbo-ci.yml`.
That guard merged with green exact-head checks in Konergy PR #231, so the shared
Konergy preset is enabled. Konergy extends the common, `node`, and `konergy`
presets but not `pnpm`, keeping lockfile maintenance and dedupe disabled and
every update human-merged. AthleteOS extends the common and `athleteos` presets;
that preset enables only its Python, uv, Gradle, Docker, and GitHub Actions
managers and intentionally excludes npm.

The Mend Renovate GitHub app must use **Selected repositories**. The
`wh1teee-org` installation includes only `PayAtTable`, `ride-os`, `athleteos`,
and `konergy`; the personal `wh1teee` installation includes only
`product-foundry` and `vpn-subscription-service`. Both personal repositories use
the same reviewed common/Node/pnpm policy instead of a second dependency bot.

## Repository contents

- `default.json` contains the common scheduling, pinning, review, and automerge
  policy.
- `node.json`, `pnpm.json`, `konergy.json`, and `athleteos.json` are composable
  ecosystem/repository presets. Konergy remains protected by its LLM exclusion,
  disabled lockfile maintenance, and human-only merge policy.
- `.github/workflows/validate.yml` validates the presets; the permanent,
  no-action `.github/workflows/jit-runner-smoke.yml` validates JIT admission.
- `.github/actionlint.yaml` declares the three custom self-hosted runner labels.
- `scripts/test-presets.mjs` checks static fleet invariants, while
  `scripts/test-jit-runner-smoke.mjs` locks down the JIT workflow contract.
- `scripts/test-renovate-fixture.mjs` runs exact-pinned Node, npm, and Renovate,
  uses Renovate's own config merge and package-rule pipeline, and separately
  proves an incompatible peer graph is rejected by npm's strict resolver.
- `test/fixtures/` contains the checked-in extraction and peer-conflict inputs.

Residual onboarding prerequisites are green consumer CI and selected-repository
GitHub app installation. None of these presets authorizes a change to
`vpn-subscription-service`.

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
- `@product-foundry/*` packages are excluded from ordinary Renovate updates;
  Product Foundry release classification, affected-consumer delivery, and exact
  consumer proof remain the only authority for those pins.
- Fleet-generated surfaces (`.fleet/generated`, `.fleet/lock.json`, Fleet-owned
  actions/workflows/config directories, and `docker/fleet`) are excluded from
  background Renovate scanning. Action pins in those files move only through the
  Fleet authority and its generated-vendored consumer wave.
- Fleet toolchain identities (Node, pnpm, Turbo, Vite/Vitest, ESLint,
  Oxlint/Oxfmt, React Doctor, and both TypeScript compiler identities) are
  disabled on the ordinary Renovate plane. Their accepted versions come from
  Fleet authority and an explicitly approved platform wave; ordinary Renovate
  continues to own unrelated dependency maintenance. TS6 compiler-API and TS7
  native typecheck remain distinct compatibility identities, not one shared
  version field.
- Compatibility families are grouped; majors, native ABI packages, database,
  auth, and security-sensitive changes remain reviewed.
- Only mature dev-only patch updates may automerge, after fourteen release days
  and required checks pass. They always merge through a PR and never use
  GitHub's platform-native automerge. All other updates remain human-merged;
  every Konergy update remains human-merged and must pass its lockfile-closure
  invariant.
- Background Renovate branch creation is limited to Minsk nights/weekends. Two
  commits per hour per repository prevents rebase storms while host admission
  controls actual runner capacity. An explicitly approved Fleet platform wave is
  not a Renovate update and therefore does not inherit this schedule or these
  bot rate limits; its own dry-run, immutable-ref, allowlist, PR, and review
  gates remain mandatory.

## Validation and rollback

Run:

```sh
node scripts/test-presets.mjs
node scripts/test-jit-runner-smoke.mjs
npm exec --yes --package=renovate@43.269.1 -- renovate-config-validator --strict --no-global default.json node.json pnpm.json konergy.json athleteos.json
node scripts/test-renovate-fixture.mjs
actionlint .github/workflows/jit-runner-smoke.yml .github/workflows/validate.yml
```

Rollback is additive and reversible: remove the consumer `renovate.json`, or
remove that repository from the GitHub app's selected-repository list. Existing
Renovate PRs can then be closed without changing source dependencies.
Shared Renovate presets for wh1teee-org repositories
