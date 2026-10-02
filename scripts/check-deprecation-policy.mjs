#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const policy = JSON.parse(
  fs.readFileSync(
    path.join(repositoryRoot, "scripts", "deprecation-allowlist.json"),
    "utf8",
  ),
);
const today = new Date().toISOString().slice(0, 10);
if (today > policy.expiresOn) {
  throw new Error(
    `Deprecation allowlist expired on ${policy.expiresOn}; ${policy.exitPath}`,
  );
}

const workspace = path.relative(repositoryRoot, process.cwd()) || ".";
const expected = policy.findings[workspace];
if (!expected) {
  throw new Error(
    `No deprecation policy entry exists for workspace ${workspace}.`,
  );
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCommand, ["ci", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
process.stdout.write(output);

if (result.error || result.status !== 0) {
  throw (
    result.error ?? new Error(`npm ci failed with exit code ${result.status}.`)
  );
}

const actual = [
  ...output.matchAll(/^npm warn deprecated (.+?)@([^@\s:]+): (.+)$/gm),
].map(([, packageName, version, message]) => ({
  package: packageName,
  version,
  message,
}));
const sortFindings = (findings) =>
  findings.map((finding) => JSON.stringify(finding)).sort();
const expectedSerialized = sortFindings(expected);
const actualSerialized = sortFindings(actual);

if (JSON.stringify(actualSerialized) !== JSON.stringify(expectedSerialized)) {
  throw new Error(
    `Unexpected deprecation warnings for ${workspace}. Expected ${expected.length}, received ${actual.length}.\n` +
      `Review the owning dependency before changing the allowlist. Exit path: ${policy.exitPath}`,
  );
}

console.log(
  `Deprecation policy passed for ${workspace}: ${actual.length} ` +
    `pinned upstream warning(s), reviewed through ${policy.expiresOn}.`,
);
