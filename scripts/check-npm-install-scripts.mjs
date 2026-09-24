#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync(
  npmCommand,
  ["approve-scripts", "--allow-scripts-pending", "--json"],
  { encoding: "utf8" },
);

if (result.error) {
  console.error(`Unable to inspect npm install-script policy: ${result.error}`);
  process.exit(1);
}

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

let report;
try {
  report = JSON.parse(result.stdout);
} catch (error) {
  console.error("npm approve-scripts returned invalid JSON:", error);
  process.stderr.write(result.stdout);
  process.exit(1);
}

const pending = (report.allowScripts ?? []).flatMap((packageReport) =>
  (packageReport.changes ?? [])
    .filter((change) => change.change === "pending")
    .map((change) => change.key ?? packageReport.name),
);

const policyFiles = [
  join(process.cwd(), "package.json"),
  join(repositoryRoot, "core/package.json"),
  join(repositoryRoot, "extensions/cli/package.json"),
  ...readdirSync(join(repositoryRoot, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      join(repositoryRoot, "packages", entry.name, "package.json"),
    ),
];
const approved = new Set();
for (const policyFile of policyFiles) {
  try {
    const policy = JSON.parse(readFileSync(policyFile, "utf8"));
    for (const [packageName, isAllowed] of Object.entries(
      policy.allowScripts ?? {},
    )) {
      if (isAllowed === true) {
        approved.add(packageName);
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    // Missing package manifests are irrelevant to the current install scope.
  }
}

const unapproved = pending.filter((packageName) => !approved.has(packageName));

if (unapproved.length > 0) {
  console.error("Unreviewed npm install scripts are present:");
  for (const packageName of unapproved) {
    console.error(`  - ${packageName}`);
  }
  console.error(
    "Review the install hook and add an exact version-pinned allowScripts entry before merging.",
  );
  process.exit(1);
}

console.log(
  `npm install-script policy is complete for this package closure (${pending.length} reviewed pending entries).`,
);
