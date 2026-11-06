#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { isForbiddenReleaseFile } from "./cli-release-pack-report.mjs";

const packagePath = path.resolve(process.cwd(), "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const repositoryRoot = path.resolve(process.cwd(), "../..");
const argumentsList = process.argv.slice(2);
const suppliedArtifact = readOption("--artifact");
const artifactPath = path.resolve(
  suppliedArtifact ??
    path.join(
      repositoryRoot,
      "release-artifacts",
      `v${packageJson.version}`,
      `opencircuit-cli-${packageJson.version}.tgz`,
    ),
);

if (
  !fs.existsSync(artifactPath) ||
  fs.lstatSync(artifactPath).isSymbolicLink()
) {
  throw new Error(
    `built release archive is missing or unsafe: ${artifactPath}`,
  );
}
const requiredFiles = [
  "package.json",
  "README.md",
  "LICENSE.txt",
  "NOTICE.txt",
  "THIRD_PARTY_NOTICES.txt",
  "dist/oc.js",
  "dist/index.js",
  "dist/meta.json",
  "dist/commands/initTemplates.d.ts",
  "dist/templateInstaller.d.ts",
  "templates/config-openai.yaml",
  "templates/config-anthropic.yaml",
  "templates/config-gemini.yaml",
  "templates/config-byom.yaml",
  "templates/config-meta.yaml",
  "templates/config-olmo.yaml",
];
const files = listArchive(artifactPath);
const missingFiles = requiredFiles.filter((file) => !files.includes(file));
const forbiddenFiles = files.filter(isForbiddenReleaseFile);
const errors = [];

if (packageJson.name !== "@opencircuit/cli") {
  errors.push(`unexpected package name: ${packageJson.name}`);
}
if (packageJson.bin?.oc !== "dist/oc.js") {
  errors.push("oc binary must point to dist/oc.js");
}
if (packageJson.main !== "dist/index.js") {
  errors.push("main must point to dist/index.js");
}
if (missingFiles.length > 0) {
  errors.push(`missing release files: ${missingFiles.join(", ")}`);
}
if (forbiddenFiles.length > 0) {
  errors.push(`forbidden release files: ${forbiddenFiles.join(", ")}`);
}
let archivePackage;
try {
  archivePackage = JSON.parse(
    readArchiveFile(artifactPath, "package/package.json"),
  );
} catch (error) {
  errors.push(
    `unable to read package/package.json from archive: ${error.message}`,
  );
}
if (
  archivePackage?.name !== packageJson.name ||
  archivePackage?.version !== packageJson.version ||
  archivePackage?.main !== "dist/index.js" ||
  archivePackage?.bin?.oc !== "dist/oc.js"
) {
  errors.push(
    "archive package identity/version/entry points do not match source",
  );
}

const report = {
  check: "opencircuit-cli-release-artifact",
  package: packageJson.name,
  version: packageJson.version,
  artifact: path.relative(repositoryRoot, artifactPath),
  source: "built archive",
  fileCount: files.length,
  requiredFiles,
  missingFiles,
  forbiddenFiles,
  status: errors.length === 0 ? "pass" : "fail",
};
console.log(JSON.stringify(report, null, 2));

if (errors.length > 0) {
  for (const error of errors) console.error(`Release artifact check: ${error}`);
  process.exitCode = 1;
} else if (packageJson.version.endsWith("-dev")) {
  console.warn(
    "Release artifact shape passed; assign a stable version before publishing.",
  );
}

function readOption(name) {
  const index = argumentsList.indexOf(name);
  if (index === -1) return undefined;
  const value = argumentsList[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`${name} requires a value`);
  return value;
}

function listArchive(archive) {
  const result = spawnSync("tar", ["-tzf", archive], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `unable to inspect built archive: ${result.error?.message ?? result.stderr.trim()}`,
    );
  }
  const rawEntries = result.stdout.split(/\r?\n/).filter(Boolean);
  const seen = new Set();
  for (const rawName of rawEntries) {
    const name = rawName.endsWith("/") ? rawName.slice(0, -1) : rawName;
    if (
      !name ||
      !name.startsWith("package/") ||
      name.includes("\\") ||
      name.split("/").some((part) => !part || part === "." || part === "..") ||
      /[\x00-\x1f\x7f]/.test(name) ||
      seen.has(name)
    ) {
      throw new Error(`unsafe or duplicate archive member: ${rawName}`);
    }
    seen.add(name);
  }
  const directories = new Set(
    rawEntries
      .filter((entry) => entry.endsWith("/"))
      .map((entry) => entry.slice(0, -1)),
  );
  return [...seen]
    .filter((name) => !directories.has(name))
    .map((name) => name.slice("package/".length));
}

function readArchiveFile(archive, member) {
  const result = spawnSync("tar", ["-xOf", archive, member], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(result.error?.message ?? result.stderr.trim());
  }
  return result.stdout;
}
