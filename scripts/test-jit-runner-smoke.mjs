import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [workflow, validationWorkflow, actionlintConfig] = await Promise.all([
  readFile(new URL("../.github/workflows/jit-runner-smoke.yml", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/validate.yml", import.meta.url), "utf8"),
  readFile(new URL("../.github/actionlint.yaml", import.meta.url), "utf8"),
]);
const workflowPath = ".github/workflows/jit-runner-smoke.yml";
const labels = "[self-hosted, Linux, X64, work-pc, general, renovate-config]";
const cachePaths = [
  "/var/cache/ci/pnpm/store",
  "/var/cache/ci/pnpm/corepack",
  "/var/cache/ci/actions-tool-cache",
  "/var/cache/ci/turbo",
  "/var/cache/ci/gradle",
  "/var/cache/ci/pub",
  "/var/cache/ci/uv",
];

assert.match(workflow, /^name: JIT runner smoke$/m);
assert.match(workflow, /^  pull_request:\n    paths:\n      - \.github\/workflows\/jit-runner-smoke\.yml$/m);
assert.match(workflow, /^  workflow_dispatch:$/m);
assert.match(workflow, /^permissions:\n  contents: read$/m);
assert.ok(workflow.includes(`runs-on: ${labels}`), "smoke job must target the exact JIT labels");
assert.ok(
  workflow.includes("github.event.pull_request.head.repo.full_name == github.repository"),
  "fork pull requests must never receive a self-hosted runner",
);
assert.doesNotMatch(workflow, /^\s*uses:/m, "smoke workflow must not download actions");
assert.doesNotMatch(workflow, /secrets\./, "smoke workflow must not read repository or organization secrets");
assert.ok(workflow.includes("/var/lib/ci-runner-jit/jobs/"), "workflow must enforce the isolated per-job root");
assert.ok(workflow.includes('jit-smoke-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT.marker'));
for (const cachePath of cachePaths) {
  assert.ok(workflow.includes(cachePath), `${cachePath} must be probed read-only`);
}
assert.ok(validationWorkflow.includes("run: node scripts/test-jit-runner-smoke.mjs"));
for (const label of ["work-pc", "general", "renovate-config"]) {
  assert.ok(actionlintConfig.includes(`    - ${label}`), `${label} must be declared for actionlint`);
}

console.log(`JIT runner smoke policy verified: ${workflowPath}`);
