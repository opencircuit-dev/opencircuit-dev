#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliDirectory = resolve(repositoryRoot, "extensions/cli");
const packageJson = JSON.parse(
  readFileSync(resolve(cliDirectory, "package.json"), "utf8"),
);

function getOutputDirectory() {
  if (process.argv.length === 2) {
    return resolve(repositoryRoot, "../opencircuit-internal");
  }

  if (process.argv.length !== 4 || process.argv[2] !== "--output-dir") {
    throw new Error("Usage: package-cli-internal.mjs [--output-dir <path>]");
  }
  return resolve(process.argv[3]);
}

const outputDirectory = getOutputDirectory();
const version = packageJson.version;

if (packageJson.name !== "@opencircuit/cli") {
  throw new Error(`Unexpected CLI package: ${packageJson.name}`);
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(
    `Release version must be stable semver, received: ${version}`,
  );
}

const artifactName = `opencircuit-cli-internal-${version}.tgz`;
const artifactPath = resolve(outputDirectory, artifactName);
const checksumPath = `${artifactPath}.sha256`;

mkdirSync(outputDirectory, { recursive: true });
const stagingDirectory = mkdtempSync(
  join(outputDirectory, ".opencircuit-cli-internal-"),
);
const npmCacheDirectory = mkdtempSync(join(tmpdir(), "opencircuit-npm-cache-"));

try {
  execFileSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["pack", "--ignore-scripts", "--pack-destination", stagingDirectory],
    {
      cwd: cliDirectory,
      stdio: "inherit",
      env: { ...process.env, npm_config_cache: npmCacheDirectory },
    },
  );

  const packedArtifact = resolve(
    stagingDirectory,
    `opencircuit-cli-${version}.tgz`,
  );
  if (!existsSync(packedArtifact)) {
    throw new Error(
      `npm pack did not create the expected archive: ${packedArtifact}`,
    );
  }

  const checksum = createHash("sha256")
    .update(readFileSync(packedArtifact))
    .digest("hex");
  const stagedArtifact = resolve(stagingDirectory, artifactName);
  const stagedChecksum = `${stagedArtifact}.sha256`;
  renameSync(packedArtifact, stagedArtifact);
  writeFileSync(stagedChecksum, `${checksum}  ${basename(artifactName)}\n`);

  renameSync(stagedArtifact, artifactPath);
  renameSync(stagedChecksum, checksumPath);

  console.log(`Internal release artifact: ${artifactPath}`);
  console.log(`SHA-256: ${checksum}`);
} finally {
  rmSync(stagingDirectory, { recursive: true, force: true });
  rmSync(npmCacheDirectory, { recursive: true, force: true });
}
