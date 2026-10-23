#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { containsCiscoProfileData } from "./cisco-release-profile.mjs";
import {
  isForbiddenReleaseFile,
  parseCliPackReport,
} from "./cli-release-pack-report.mjs";

const packagePath = path.resolve(process.cwd(), "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const temporaryCache = fs.mkdtempSync(
  path.join(os.tmpdir(), "opencircuit-npm-cache-"),
);
const result = spawnSync(
  npmCommand,
  ["pack", "--dry-run", "--json", "--ignore-scripts"],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, npm_config_cache: temporaryCache },
  },
);
fs.rmSync(temporaryCache, { recursive: true, force: true });

if (result.error) throw result.error;
if (result.status !== 0) {
  console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let packReport;
try {
  packReport = parseCliPackReport(result.stdout, packageJson);
} catch (error) {
  throw new Error(`Invalid npm pack report: ${error.message}`);
}

const files = packReport.files.map((entry) => entry.path);
const requiredFiles = [
  "package.json",
  "README.md",
  "dist/oc.js",
  "dist/index.js",
  "dist/meta.json",
  "dist/commands/initTemplates.d.ts",
  "dist/templateInstaller.d.ts",
  "templates/config-openai.yaml",
  "templates/config-anthropic.yaml",
  "templates/config-gemini.yaml",
  "templates/config-byom.yaml",
  "templates/config-cisco.yaml",
  "templates/config-cisco-circuit.yaml",
  "templates/config-cisco-oauth.yaml",
  "templates/config-devnet.yaml",
  "templates/config-meta.yaml",
  "templates/config-olmo.yaml",
];
const missingFiles = requiredFiles.filter((file) => !files.includes(file));
const forbiddenFiles = files.filter((file) =>
  isForbiddenReleaseFile(file, { allowInternalTemplates: true }),
);
// Public builds must never carry the protected Cisco profile.
const profileDataFiles = files.filter((file) => {
  const fullPath = path.resolve(process.cwd(), file);
  const stat = fs.statSync(fullPath, { throwIfNoEntry: false });
  const content =
    stat?.isFile() && stat.size <= 32 * 1024 * 1024
      ? fs.readFileSync(fullPath, "utf8")
      : "";
  return containsCiscoProfileData(file, content);
});
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
if (profileDataFiles.length > 0) {
  errors.push(
    `Cisco profile data must not be in public builds: ${profileDataFiles.join(", ")}`,
  );
}

const report = {
  check: "opencircuit-cli-release-artifact",
  package: packageJson.name,
  version: packageJson.version,
  fileCount: files.length,
  requiredFiles,
  missingFiles,
  forbiddenFiles,
  profileDataFiles,
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
