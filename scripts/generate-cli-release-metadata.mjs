#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliRoot = resolve(repositoryRoot, "extensions/cli");
const argumentsList = process.argv.slice(2);
const artifact = resolve(requiredOption("--artifact"));
const outputDirectory = resolve(option("--output-dir") ?? dirname(artifact));
const packageJson = JSON.parse(
  readFileSync(resolve(cliRoot, "package.json"), "utf8"),
);
const lockfile = resolve(cliRoot, "package-lock.json");
const artifactName = basename(artifact);
const stem = artifactName.replace(/\.tgz$/, "");

if (!/^opencircuit-cli-\d+\.\d+\.\d+\.tgz$/.test(artifactName)) {
  throw new Error(`unexpected CLI artifact name: ${artifactName}`);
}

const artifactSha256 = sha256(artifact);
const lockfileSha256 = sha256(lockfile);
const sbom = execFileSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  [
    "sbom",
    "--package-lock-only",
    "--omit",
    "dev",
    "--sbom-format",
    "cyclonedx",
    "--sbom-type",
    "application",
  ],
  { cwd: cliRoot, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
);
const sbomPath = resolve(outputDirectory, `${stem}.sbom.cdx.json`);
writeFileSync(sbomPath, `${sbom.trim()}\n`);

const provenance = {
  schemaVersion: "open-circuit.provenance.v1",
  product: "Open Circuit",
  artifact: {
    name: artifactName,
    version: packageJson.version,
    sha256: artifactSha256,
    sizeBytes: readFileSync(artifact).byteLength,
  },
  source: {
    repository: "https://github.com/opencircuit-dev/opencircuit-dev",
    commit: git("rev-parse", "HEAD"),
    tag:
      process.env.GITHUB_REF_TYPE === "tag"
        ? process.env.GITHUB_REF_NAME
        : null,
    dirty: git("status", "--porcelain") !== "",
  },
  build: {
    workflow: process.env.GITHUB_WORKFLOW ?? "local",
    runId: process.env.GITHUB_RUN_ID ?? null,
    builder: process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
    os: process.env.RUNNER_OS ?? process.platform,
    architecture: process.env.RUNNER_ARCH ?? process.arch,
    node: process.version,
    npm: execFileSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["--version"],
      {
        encoding: "utf8",
      },
    ).trim(),
    lockfileSha256,
    sourceDateEpoch: process.env.SOURCE_DATE_EPOCH ?? null,
  },
  materials: [
    {
      type: "npm-lockfile",
      path: "extensions/cli/package-lock.json",
      sha256: lockfileSha256,
    },
  ],
  verification: {
    sbom: `${stem}.sbom.cdx.json`,
    notices: `${stem}.NOTICES.txt`,
  },
};
const provenancePath = resolve(outputDirectory, `${stem}.provenance.json`);
writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);

const notices = [
  readFileSync(resolve(cliRoot, "NOTICE.txt"), "utf8").trim(),
  readFileSync(resolve(cliRoot, "THIRD_PARTY_NOTICES.txt"), "utf8").trim(),
].join("\n\n");
const noticesPath = resolve(outputDirectory, `${stem}.NOTICES.txt`);
writeFileSync(noticesPath, `${notices}\n`);

console.log(`Release metadata: ${provenancePath}`);
console.log(`Release SBOM: ${sbomPath}`);
console.log(`Release notices: ${noticesPath}`);

function option(name) {
  const index = argumentsList.indexOf(name);
  return index === -1 ? undefined : argumentsList[index + 1];
}

function requiredOption(name) {
  const value = option(name);
  if (!value || value.startsWith("--"))
    throw new Error(`${name} requires a value`);
  return value;
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}
