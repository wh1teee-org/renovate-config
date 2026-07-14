import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const load = (name) => JSON.parse(readFileSync(join(root, name), "utf8"));

const mergePresets = (...presets) => {
  const result = {};
  for (const preset of presets) {
    for (const [key, value] of Object.entries(preset)) {
      if (Array.isArray(value)) {
        result[key] = [...(result[key] ?? []), ...value];
      } else if (value && typeof value === "object") {
        result[key] = { ...(result[key] ?? {}), ...value };
      } else {
        result[key] = value;
      }
    }
  }
  return result;
};

const patternMatches = (value, rawPattern) => {
  const negated = rawPattern.startsWith("!");
  const pattern = negated ? rawPattern.slice(1) : rawPattern;
  let matches;
  if (pattern.startsWith("/") && pattern.endsWith("/")) {
    matches = new RegExp(pattern.slice(1, -1)).test(value);
  } else {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("**", "\u0000").replaceAll("*", ".*").replaceAll("\u0000", ".*");
    matches = new RegExp(`^${escaped}$`).test(value);
  }
  return negated ? !matches : matches;
};

const listMatches = (value, patterns) => {
  if (!patterns) return true;
  if (typeof patterns === "string") patterns = [patterns];
  const negative = patterns.filter((pattern) => pattern.startsWith("!"));
  if (negative.some((pattern) => !patternMatches(value, pattern))) return false;
  const positive = patterns.filter((pattern) => !pattern.startsWith("!"));
  return positive.length === 0 || positive.some((pattern) => patternMatches(value, pattern));
};

const ruleMatches = (dependency, rule) =>
  listMatches(dependency.manager, rule.matchManagers) &&
  listMatches(dependency.depType, rule.matchDepTypes) &&
  listMatches(dependency.depName, rule.matchDepNames) &&
  listMatches(dependency.packageName, rule.matchPackageNames) &&
  listMatches(dependency.updateType, rule.matchUpdateTypes) &&
  listMatches(dependency.currentVersion, rule.matchCurrentVersion);

const effectiveRule = (config, dependency) => {
  const result = {
    automerge: config.automerge ?? false,
    automergeType: config.automergeType,
    enabled: config.enabled ?? true,
    platformAutomerge: config.platformAutomerge,
    rangeStrategy: config.rangeStrategy,
  };
  for (const rule of config.packageRules ?? []) {
    if (ruleMatches(dependency, rule)) Object.assign(result, rule);
  }
  return result;
};

const base = load("default.json");
const node = load("node.json");
const pnpm = load("pnpm.json");
const konergy = load("konergy.json");
const effective = mergePresets(base, node, pnpm);
const konergyEffective = mergePresets(base, node, konergy);

const fixtureDir = join(root, "test", "fixtures", "node");
const workDir = mkdtempSync(join(tmpdir(), "renovate-policy-fixture-"));
cpSync(fixtureDir, workDir, { recursive: true });
writeFileSync(
  join(workDir, "renovate.json"),
  JSON.stringify(
    {
      ...effective,
      dependencyDashboard: false,
      enabledManagers: ["npm"],
      lockFileMaintenance: { enabled: false },
      schedule: ["at any time"],
      skipInstalls: true,
      updateNotScheduled: true,
    },
    null,
    2,
  ),
);

try {
  const run = spawnSync(
    "npm",
    [
      "exec",
      "--yes",
      "--package=node@24.18.0",
      "--package=renovate@43.263.5",
      "--",
      "renovate",
      "--platform=local",
      "--dry-run=lookup",
    ],
    {
      cwd: workDir,
      encoding: "utf8",
      env: { ...process.env, LOG_FORMAT: "json", LOG_LEVEL: "debug" },
      maxBuffer: 50 * 1024 * 1024,
      timeout: 120_000,
    },
  );

  const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
  assert.equal(run.error, undefined, `Renovate fixture lookup failed to start: ${run.error?.message}`);
  assert.equal(run.status, 0, `Renovate fixture lookup failed:\n${output.split("\n").filter((line) => /error|fatal/i.test(line)).slice(0, 8).join("\n")}`);

  const records = output.split(/\r?\n/).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const dependencies = [];
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value.depName && value.depType) dependencies.push(value);
    Object.values(value).forEach(visit);
  };
  records.forEach(visit);

  const findDependency = (depName, depType) => dependencies.find((dependency) => dependency.depName === depName && dependency.depType === depType);
  const ts6 = findDependency("typescript", "devDependencies");
  const ts7 = findDependency("@typescript/native", "devDependencies");
  const peerReact = findDependency("react", "peerDependencies");
  const catalogZod = findDependency("zod", "pnpm.catalog.schema");

  assert.equal(ts6?.packageName, "@typescript/typescript6", "Renovate must extract the TS6 API alias");
  assert.equal(ts7?.packageName, "typescript", "Renovate must extract the TS7 native alias");
  assert.equal(peerReact?.currentValue, "^18.0.0", "the conflicting peer range must remain visible to policy evaluation");
  assert.equal(catalogZod?.currentValue, "4.4.2", "Renovate must extract repo-local pnpm catalogs");

  const caseFor = (depName, packageName, depType, currentVersion, updateType = "patch") => ({
    manager: "npm",
    depName,
    packageName,
    depType,
    currentVersion,
    updateType,
  });
  const cases = {
    ordinary: caseFor("prettier", "prettier", "devDependencies", "3.9.4"),
    security: caseFor("better-auth", "better-auth", "devDependencies", "1.6.0"),
    native: caseFor("sharp", "sharp", "devDependencies", "0.34.4"),
    eslint: caseFor("eslint", "eslint", "devDependencies", "9.39.3"),
    ts6: caseFor("typescript", "@typescript/typescript6", "devDependencies", "6.0.1"),
    ts7: caseFor("@typescript/native", "typescript", "devDependencies", "7.0.2"),
    turbo: caseFor("turbo", "turbo", "devDependencies", "2.10.4"),
    vite: caseFor("vite", "vite", "devDependencies", "8.1.3"),
    vitest: caseFor("vitest", "vitest", "devDependencies", "4.1.9"),
    peer: caseFor("react", "react", "peerDependencies", "18.0.0", "major"),
    prisma: caseFor("@prisma/client", "@prisma/client", "dependencies", "7.7.0"),
    pnpmAction: caseFor("pnpm/action-setup", "pnpm/action-setup", "action", "6.0.9"),
    nodeRuntime: caseFor("node", "node", "engines", "24.18.0"),
  };

  for (const name of ["ordinary", "security", "native", "eslint", "turbo", "vite", "vitest", "prisma"]) {
    assert.ok(findDependency(cases[name].depName, cases[name].depType), `${name} must come from the Renovate fixture lookup`);
  }

  const ordinary = effectiveRule(effective, cases.ordinary);
  assert.equal(ordinary.automerge, true, "ordinary mature dev patches should be the only automerge lane");
  assert.equal(ordinary.automergeType, "pr");
  assert.equal(ordinary.platformAutomerge, false);

  for (const name of ["security", "native", "eslint", "ts6", "ts7", "turbo", "vite", "vitest", "pnpmAction", "nodeRuntime"]) {
    assert.equal(effectiveRule(effective, cases[name]).automerge, false, `${name} updates must never automerge`);
  }
  assert.equal(effectiveRule(effective, cases.ts6).groupName, "typescript 6 api lane");
  assert.equal(effectiveRule(effective, cases.ts7).groupName, "typescript 7 native lane");
  assert.equal(effectiveRule(effective, cases.vite).groupName, "vite and vitest");
  assert.equal(effectiveRule(effective, cases.vitest).groupName, "vite and vitest");
  assert.equal(effectiveRule(effective, cases.prisma).groupName, "prisma");
  assert.equal(effectiveRule(effective, cases.pnpmAction).groupName, "pnpm setup action");
  assert.equal(effectiveRule(effective, cases.nodeRuntime).groupName, "node 24 runtime");

  const assertPeerConflictRejected = (config) => {
    const peer = effectiveRule(config, cases.peer);
    if (peer.rangeStrategy !== "widen" || peer.automerge) throw new Error("peer-conflict rejection: peer updates must widen and require review");
  };
  assert.doesNotThrow(() => assertPeerConflictRejected(effective));
  const unsafePeerConfig = structuredClone(effective);
  unsafePeerConfig.packageRules.push({ matchDepTypes: ["peerDependencies"], rangeStrategy: "pin", automerge: true });
  assert.throws(() => assertPeerConflictRejected(unsafePeerConfig), /peer-conflict rejection/);

  assert.equal(konergyEffective.lockFileMaintenance.enabled, false);
  assert.ok(!(konergyEffective.postUpdateOptions ?? []).includes("pnpmDedupe"));
  assert.equal(effectiveRule(konergyEffective, cases.ordinary).automerge, false, "Konergy updates must never silently merge shared-lockfile changes");

  console.log("Renovate fixture verified: local lookup, catalogs, TS aliases, grouping, rule order, and peer-conflict rejection.");
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
