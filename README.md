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
    "github>wh1teee-org/renovate-config:node"
  ]
}
```

Konergy additionally extends `github>wh1teee-org/renovate-config:konergy` so
`packages/llm/**` remains untouched. AthleteOS extends the common and
`athleteos` presets; that preset enables only its Python, uv, Gradle, Docker,
and GitHub Actions managers and intentionally excludes npm.

The Mend Renovate GitHub app must use **Selected repositories** and include
only `PayAtTable`, `ride-os`, `athleteos`, and `konergy`. The protected personal
`vpn-subscription-service` repository is not installed or onboarded.

## Policy

- Direct dependency declarations and container/action references are pinned.
- pnpm catalogs stay repo-local; Renovate updates them through the npm manager
  and runs `pnpmDedupe` after lockfile changes.
- TypeScript's TS6 compiler-API alias and TS7 native typecheck alias are separate
  approval lanes.
- Compatibility families are grouped; majors, native ABI packages, database,
  auth, and security-sensitive changes remain reviewed.
- Only mature dev-only patch updates may automerge, after seven release days and
  required checks pass. All other updates remain human-merged.
- Branch creation is limited to Minsk nights/weekends. Two commits per hour per
  repository prevents rebase storms while host admission controls actual runner
  capacity.

## Validation and rollback

Run:

```sh
node scripts/test-presets.mjs
npm exec --yes --package=renovate@43.263.5 -- renovate-config-validator --strict --no-global default.json node.json konergy.json athleteos.json
```

Rollback is additive and reversible: remove the consumer `renovate.json`, or
remove that repository from the GitHub app's selected-repository list. Existing
Renovate PRs can then be closed without changing source dependencies.
Shared Renovate presets for wh1teee-org repositories
