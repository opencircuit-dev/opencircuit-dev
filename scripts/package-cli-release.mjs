#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliDirectory = resolve(repositoryRoot, "extensions/cli");
const packageJson = JSON.parse(
  readFileSync(resolve(cliDirectory, "package.json"), "utf8"),
);
const version = packageJson.version;
const artifactDirectory = resolve(
  repositoryRoot,
  "release-artifacts",
  `v${version}`,
);

if (packageJson.name !== "@opencircuit/cli") {
  throw new Error(`Unexpected CLI package: ${packageJson.name}`);
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(
    `Release version must be stable semver, received: ${version}`,
  );
}

mkdirSync(artifactDirectory, { recursive: true });
execFileSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["pack", "--pack-destination", artifactDirectory],
  { cwd: cliDirectory, stdio: "inherit" },
);

const artifactName = `opencircuit-cli-${version}.tgz`;
const artifactPath = resolve(artifactDirectory, artifactName);
const checksum = createHash("sha256")
  .update(readFileSync(artifactPath))
  .digest("hex");
writeFileSync(
  `${artifactPath}.sha256`,
  `${checksum}  ${basename(artifactPath)}\n`,
);

console.log(`Release artifact: ${artifactPath}`);
console.log(`SHA-256: ${checksum}`);
