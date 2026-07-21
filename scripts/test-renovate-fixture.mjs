import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const NODE_VERSION = "24.18.0";
const NPM_VERSION = "11.6.2";
const RENOVATE_VERSION = "43.269.1";
const childFlag = "RENOVATE_POLICY_PINNED_RUNTIME";
const scriptPath = fileURLToPath(import.meta.url);
const root = join(dirname(scriptPath), "..");
const load = (name) => JSON.parse(readFileSync(join(root, name), "utf8"));
const temporaryDirectories = new Set();
const temporaryDirectory = (prefix) => {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.add(directory);
  return directory;
};
const removeTemporaryDirectory = (directory) => {
  rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.delete(directory);
};
process.on("exit", () => temporaryDirectories.forEach((directory) => rmSync(directory, { recursive: true, force: true })));

if (process.env[childFlag] !== "1") {
  const pinnedRuntimeProcess = spawnSync(
    "npm",
    [
      "exec",
      "--yes",
      `--package=node@${NODE_VERSION}`,
      `--package=npm@${NPM_VERSION}`,
      `--package=renovate@${RENOVATE_VERSION}`,
      "--",
      "node",
      scriptPath,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, [childFlag]: "1" },
      maxBuffer: 50 * 1024 * 1024,
      timeout: 180_000,
    },
  );

  process.stdout.write(pinnedRuntimeProcess.stdout ?? "");
  process.stderr.write(pinnedRuntimeProcess.stderr ?? "");
  assert.equal(
    pinnedRuntimeProcess.error,
    undefined,
    `Pinned fixture runtime failed to start: ${pinnedRuntimeProcess.error?.message}`,
  );
  assert.equal(pinnedRuntimeProcess.status, 0, "Pinned Renovate fixture verification failed");
} else {
  await verifyWithPinnedRenovate();
}

async function verifyWithPinnedRenovate() {
  assert.equal(process.version, `v${NODE_VERSION}`, "Fixture must use the exact pinned Node.js version");
  const binary = (name) =>
    process.env.PATH.split(delimiter)
      .map((directory) => join(directory, name))
      .find(existsSync);
  const renovateBinary = binary("renovate");
  assert.ok(renovateBinary, "Pinned Renovate binary must be available on PATH");

  const renovateEntry = realpathSync(renovateBinary);
  const renovateRoot = dirname(dirname(renovateEntry));
  const renovatePackage = JSON.parse(readFileSync(join(renovateRoot, "package.json"), "utf8"));
  assert.equal(renovatePackage.version, RENOVATE_VERSION, "Fixture must use the exact pinned Renovate version");

  const [{ mergeChildConfig }, { applyPackageRules }] = await Promise.all([
    import(pathToFileURL(join(renovateRoot, "dist", "config", "utils.js"))),
    import(pathToFileURL(join(renovateRoot, "dist", "util", "package-rules", "index.js"))),
  ]);
  assert.equal(typeof mergeChildConfig, "function", "Pinned Renovate mergeChildConfig API changed");
  assert.equal(typeof applyPackageRules, "function", "Pinned Renovate applyPackageRules API changed");

  const mergeWithRenovate = (...presets) => presets.reduce((config, preset) => mergeChildConfig(config, preset), {});
  const base = load("default.json");
  const node = load("node.json");
  const pnpm = load("pnpm.json");
  const konergy = load("konergy.json");
  const athleteos = load("athleteos.json");
  const effective = mergeWithRenovate(base, node, pnpm);
  const konergyEffective = mergeWithRenovate(base, node, konergy);
  const repositoryProfiles = {
    RideOS: effective,
    PayAtTable: effective,
    athleteos: mergeWithRenovate(base, athleteos),
    Konergy: konergyEffective,
  };

  assert.equal(
    effective.packageRules.length,
    base.packageRules.length + node.packageRules.length,
    "Renovate must merge packageRules from the common and Node presets",
  );
  for (const [repository, profile] of Object.entries(repositoryProfiles)) {
    assert.equal(profile.rangeStrategy, "pin", `${repository} direct dependencies must remain exact-pinned`);
    const majorRule = profile.packageRules.find((rule) => rule.matchUpdateTypes?.includes("major"));
    assert.equal(majorRule?.dependencyDashboardApproval, true, `${repository} majors must require dashboard approval`);
    assert.equal(majorRule?.automerge, false, `${repository} majors must never automerge`);
  }
  for (const groupName of ["react runtime", "prisma", "vite and vitest"]) {
    assert.ok(
      repositoryProfiles.RideOS.packageRules.some((rule) => rule.groupName === groupName),
      `RideOS must retain the ${groupName} compatibility group`,
    );
    assert.ok(
      repositoryProfiles.PayAtTable.packageRules.some((rule) => rule.groupName === groupName),
      `PayAtTable must retain the ${groupName} compatibility group`,
    );
  }
  for (const groupName of ["uv toolchain", "fastapi and pydantic", "android build toolchain"]) {
    assert.ok(
      repositoryProfiles.athleteos.packageRules.some((rule) => rule.groupName === groupName),
      `athleteos must retain the ${groupName} compatibility group`,
    );
  }

  const fixtureDir = join(root, "test", "fixtures", "node");
  const workDir = temporaryDirectory("renovate-policy-fixture-");
  cpSync(fixtureDir, workDir, { recursive: true });
  writeFileSync(
    join(workDir, "renovate.json"),
    JSON.stringify(
      mergeChildConfig(effective, {
        dependencyDashboard: false,
        enabledManagers: ["npm", "github-actions"],
        lockFileMaintenance: { enabled: false },
        schedule: ["at any time"],
        skipInstalls: true,
        updateNotScheduled: true,
      }),
      null,
      2,
    ),
  );

  const lookup = spawnSync(renovateBinary, ["--platform=local", "--dry-run=lookup"], {
    cwd: workDir,
    encoding: "utf8",
    env: { ...process.env, LOG_FORMAT: "json", LOG_LEVEL: "debug" },
    maxBuffer: 50 * 1024 * 1024,
    timeout: 120_000,
  });

  const output = `${lookup.stdout ?? ""}\n${lookup.stderr ?? ""}`;
  assert.equal(lookup.error, undefined, `Renovate fixture lookup failed to start: ${lookup.error?.message}`);
  assert.equal(
    lookup.status,
    0,
    `Renovate fixture lookup failed:\n${output
      .split("\n")
      .filter((line) => /error|fatal/i.test(line))
      .slice(0, 8)
      .join("\n")}`,
  );

  const records = output.split(/\r?\n/).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const dependencies = [];
  const collectDependencies = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(collectDependencies);
      return;
    }
    if (value.depName && value.depType) dependencies.push(value);
    Object.values(value).forEach(collectDependencies);
  };
  records.forEach(collectDependencies);

  const findDependency = (depName, depType) =>
    dependencies.find((dependency) => dependency.depName === depName && dependency.depType === depType);
  const ts6 = findDependency("typescript", "devDependencies");
  const ts7 = findDependency("@typescript/native", "devDependencies");
  const peerReact = findDependency("react", "peerDependencies");
  const catalogZod = findDependency("zod", "pnpm.catalog.schema");

  assert.equal(ts6?.packageName, "@typescript/typescript6", "Renovate must extract the TS6 API alias");
  assert.equal(ts7?.packageName, "typescript", "Renovate must extract the TS7 native alias");
  assert.equal(peerReact?.currentValue, "^18.0.0", "Renovate must expose the peer range to its update policy");
  assert.equal(catalogZod?.currentValue, "4.4.2", "Renovate must extract repo-local pnpm catalogs");

  const policyCase = ({ depName, depType, currentVersion, updateType = "patch" }) => {
    const extracted = findDependency(depName, depType);
    assert.ok(extracted, `${depName} (${depType}) must come from the real Renovate fixture lookup`);
    return {
      ...extracted,
      manager: extracted.manager ?? (depType === "action" ? "github-actions" : "npm"),
      currentVersion,
      updateType,
    };
  };
  const cases = {
    ordinary: policyCase({ depName: "prettier", depType: "devDependencies", currentVersion: "3.9.4" }),
    major: policyCase({
      depName: "prettier",
      depType: "devDependencies",
      currentVersion: "3.9.4",
      updateType: "major",
    }),
    security: policyCase({ depName: "better-auth", depType: "devDependencies", currentVersion: "1.6.0" }),
    native: policyCase({ depName: "sharp", depType: "devDependencies", currentVersion: "0.34.4" }),
    eslint: policyCase({ depName: "eslint", depType: "devDependencies", currentVersion: "9.39.3" }),
    ts6: policyCase({ depName: "typescript", depType: "devDependencies", currentVersion: "6.0.1" }),
    ts7: policyCase({ depName: "@typescript/native", depType: "devDependencies", currentVersion: "7.0.2" }),
    turbo: policyCase({ depName: "turbo", depType: "devDependencies", currentVersion: "2.10.4" }),
    vite: policyCase({ depName: "vite", depType: "devDependencies", currentVersion: "8.1.3" }),
    vitest: policyCase({ depName: "vitest", depType: "devDependencies", currentVersion: "4.1.9" }),
    peer: policyCase({ depName: "react", depType: "peerDependencies", currentVersion: "18.0.0", updateType: "major" }),
    prisma: policyCase({ depName: "@prisma/client", depType: "dependencies", currentVersion: "7.7.0" }),
    pnpmAction: policyCase({ depName: "pnpm/action-setup", depType: "action", currentVersion: "4.0.0" }),
    nodeRuntime: policyCase({ depName: "node", depType: "engines", currentVersion: "24.18.0" }),
  };
  const evaluate = (dependency) => applyPackageRules({ ...effective, ...dependency }, "package-rules");

  const ordinary = await evaluate(cases.ordinary);
  assert.equal(ordinary.automerge, true, "ordinary mature dev patches should be the only automerge lane");
  assert.equal(ordinary.automergeType, "pr");
  assert.equal(ordinary.platformAutomerge, false);

  const major = await evaluate(cases.major);
  assert.equal(major.dependencyDashboardApproval, true, "major updates must require dashboard approval");
  assert.equal(major.automerge, false, "major updates must never automerge");

  for (const name of ["security", "native", "eslint", "ts6", "ts7", "turbo", "vite", "vitest", "pnpmAction", "nodeRuntime"]) {
    assert.equal((await evaluate(cases[name])).automerge, false, `${name} updates must never automerge`);
  }
  assert.equal((await evaluate(cases.ts6)).groupName, "typescript 6 api lane");
  assert.equal((await evaluate(cases.ts7)).groupName, "typescript 7 native lane");
  assert.equal((await evaluate(cases.vite)).groupName, "vite and vitest");
  assert.equal((await evaluate(cases.vitest)).groupName, "vite and vitest");
  assert.equal((await evaluate(cases.prisma)).groupName, "prisma");
  assert.equal((await evaluate(cases.pnpmAction)).groupName, "pnpm setup action");
  assert.equal((await evaluate(cases.nodeRuntime)).groupName, "node 24 runtime");

  const peerPolicy = await evaluate(cases.peer);
  assert.equal(peerPolicy.rangeStrategy, "widen", "Renovate must widen peer declarations instead of pinning them");
  assert.equal(peerPolicy.automerge, false, "Renovate peer updates must require review");

  assert.equal(konergyEffective.enabled, true, "Konergy must remain enabled after its immutable-lockfile CI guard landed");
  assert.equal(konergyEffective.lockFileMaintenance.enabled, false);
  assert.ok(!(konergyEffective.postUpdateOptions ?? []).includes("pnpmDedupe"));
  assert.equal((await applyPackageRules({ ...konergyEffective, ...cases.ordinary })).automerge, false);

  verifyPackageManagerPeerConflict(binary("npm"));
  removeTemporaryDirectory(workDir);
  console.log(
    "Pinned Renovate verified: four repository profiles, real config merge/extraction/grouping, gated majors; npm independently rejected the peer-conflict fixture.",
  );
}

function verifyPackageManagerPeerConflict(npmBinary) {
  assert.ok(npmBinary, "Pinned npm binary must be available on PATH");
  const npmVersion = spawnSync(npmBinary, ["--version"], { encoding: "utf8" });
  assert.equal(npmVersion.status, 0, "Pinned npm version check must succeed");
  assert.equal(npmVersion.stdout.trim(), NPM_VERSION, "Peer-conflict proof must use the exact pinned npm version");

  const fixtureDir = join(root, "test", "fixtures", "peer-conflict");
  const workDir = temporaryDirectory("renovate-policy-peer-conflict-");
  cpSync(fixtureDir, workDir, { recursive: true });
  const install = spawnSync(npmBinary, ["install", "--package-lock-only", "--ignore-scripts", "--strict-peer-deps"], {
    cwd: workDir,
    encoding: "utf8",
    timeout: 60_000,
  });
  const output = `${install.stdout ?? ""}\n${install.stderr ?? ""}`;
  assert.equal(install.error, undefined, `npm peer-conflict fixture failed to start: ${install.error?.message}`);
  assert.notEqual(install.status, 0, "npm strict peer resolution must reject the incompatible fixture");
  assert.match(output, /ERESOLVE/);
  assert.match(output, /peer react@"\^18\.0\.0"/);
  removeTemporaryDirectory(workDir);
}
