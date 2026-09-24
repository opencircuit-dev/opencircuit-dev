#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  packReport = JSON.parse(result.stdout);
} catch (error) {
  throw new Error(`npm pack returned invalid JSON: ${error.message}`);
}

const files = (packReport[0]?.files ?? []).map((entry) => entry.path);
const requiredFiles = [
  "package.json",
  "README.md",
  "dist/oc.js",
  "dist/index.js",
  "dist/meta.json",
  "scripts/install-templates.mjs",
  "templates/config-openai.yaml",
  "templates/config-anthropic.yaml",
  "templates/config-gemini.yaml",
  "templates/config-byom.yaml",
];
const missingFiles = requiredFiles.filter((file) => !files.includes(file));
const forbiddenFiles = files.filter(
  (file) =>
    file.includes("node_modules/") ||
    file === ".env" ||
    file.endsWith(".pem") ||
    file.endsWith(".key") ||
    /(^|\/)credentials(?:\.|\/|$)/i.test(file),
);
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

const report = {
  check: "opencircuit-cli-release-artifact",
  package: packageJson.name,
  version: packageJson.version,
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
    "Release artifact shape passed; semantic-release must replace the development version before publishing.",
  );
}
