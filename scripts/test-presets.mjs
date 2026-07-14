import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const load = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));

const [base, node, konergy, athleteos] = await Promise.all([
  load("default.json"),
  load("node.json"),
  load("konergy.json"),
  load("athleteos.json"),
]);

assert.equal(base.rangeStrategy, "pin", "direct dependencies must remain exact-pinned");
assert.equal(base.pinDigests, true, "container and action references must remain digest-pinned");
assert.equal(base.dependencyDashboard, true, "the fleet needs one approval/status surface per repository");
assert.ok(base.commitHourlyLimit > 0, "CI-triggering commits must be rate-limited");
assert.ok(base.prConcurrentLimit >= base.commitHourlyLimit, "open PR capacity must not be below the hourly commit rate");

const onlyAutomergeRule = base.packageRules.filter((rule) => rule.automerge === true);
assert.equal(onlyAutomergeRule.length, 1, "automerge must stay restricted to one proven low-risk rule");
assert.deepEqual(onlyAutomergeRule[0].matchUpdateTypes, ["patch"]);
assert.equal(onlyAutomergeRule[0].minimumReleaseAge, "7 days");

const nodeRules = node.packageRules;
const peerRule = nodeRules.find((rule) => rule.matchDepTypes?.includes("peerDependencies"));
assert.equal(peerRule?.rangeStrategy, "widen", "peer ranges must never be exact-pinned");
assert.equal(peerRule?.automerge, false, "peer changes require review");

const ts6Rule = nodeRules.find((rule) => rule.groupName === "typescript 6 api lane");
assert.deepEqual(ts6Rule?.matchDepNames, ["typescript"]);
assert.deepEqual(ts6Rule?.matchPackageNames, ["@typescript/typescript6"]);
assert.equal(ts6Rule?.allowedVersions, ">=6.0.0 <7.0.0");

const ts7Rule = nodeRules.find((rule) => rule.groupName === "typescript 7 native lane");
assert.deepEqual(ts7Rule?.matchDepNames, ["@typescript/native"]);
assert.deepEqual(ts7Rule?.matchPackageNames, ["typescript"]);
assert.equal(ts7Rule?.allowedVersions, ">=7.0.0 <8.0.0");
assert.notEqual(ts6Rule?.groupName, ts7Rule?.groupName, "TS6 API and TS7 native updates must never share a branch");

const pnpmCapRule = nodeRules.find((rule) => rule.allowedVersions === ">=11.0.0 <12.0.0");
assert.deepEqual(pnpmCapRule?.matchPackageNames, ["pnpm"], "the pnpm major cap must not block action versions");

assert.ok(node.postUpdateOptions.includes("pnpmDedupe"), "pnpm lockfiles must be deduplicated after updates");
assert.deepEqual(konergy.ignorePaths, ["packages/llm/**"], "deprecated Konergy LLM code must remain untouched");
assert.ok(!athleteos.enabledManagers.includes("npm"), "AthleteOS must remain a Python/Gradle repository");
assert.ok(athleteos.enabledManagers.includes("pep621"));
assert.ok(athleteos.enabledManagers.includes("gradle-wrapper"));

console.log("Preset invariants verified: exact pins, peer widening, TS lane isolation, Konergy LLM exclusion, AthleteOS non-Node managers.");
