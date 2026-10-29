#!/usr/bin/env node

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliRoot = resolve(repositoryRoot, "extensions/cli");
const metadataPath = resolve(cliRoot, "dist/meta.json");
const outputPath = resolve(cliRoot, "THIRD_PARTY_NOTICES.txt");
const maximumNoticeBytes = 1024 * 1024;

if (!existsSync(metadataPath)) {
  throw new Error(
    "extensions/cli/dist/meta.json is required to generate notices",
  );
}

const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
const packageRoots = new Map();

function findPackageRoot(inputPath) {
  let directory = resolve(cliRoot, inputPath);
  if (!existsSync(directory)) return undefined;
  try {
    if (statSync(directory).isFile()) directory = dirname(directory);
  } catch {
    return undefined;
  }
  while (directory.startsWith(repositoryRoot)) {
    const packagePath = resolve(directory, "package.json");
    if (existsSync(packagePath)) return directory;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

function addPackage(packageRoot) {
  const packagePath = resolve(packageRoot, "package.json");
  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  } catch {
    return;
  }
  if (
    typeof packageJson.name !== "string" ||
    typeof packageJson.version !== "string"
  ) {
    return;
  }
  packageRoots.set(`${packageJson.name}@${packageJson.version}`, {
    name: packageJson.name,
    version: packageJson.version,
    license: packageJson.license ?? packageJson.licenses ?? "UNKNOWN",
    root: packageRoot,
  });
}

for (const input of Object.keys(metadata.inputs ?? {})) {
  const packageRoot = findPackageRoot(input);
  if (packageRoot) addPackage(packageRoot);
}

function findNoticeFiles(packageRoot) {
  return readdirSync(packageRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && /^(?:licen[cs]e|copying|notice)/i.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

const sections = [
  "Open Circuit CLI third-party notices",
  "",
  "This file is generated from extensions/cli/dist/meta.json during release packaging.",
  "It describes packages whose code is included in the bundled CLI.",
  "",
];

for (const dependency of [...packageRoots.values()].sort((left, right) =>
  `${left.name}@${left.version}`.localeCompare(
    `${right.name}@${right.version}`,
  ),
)) {
  const files = findNoticeFiles(dependency.root);
  sections.push(`${dependency.name}@${dependency.version}`);
  sections.push(`License: ${formatLicense(dependency.license)}`);
  if (files.length === 0) {
    sections.push(
      "License text: not included by the package; see the package metadata and source distribution.",
    );
  } else {
    for (const file of files) {
      const path = resolve(dependency.root, file);
      const text = readFileSync(path, "utf8");
      if (Buffer.byteLength(text) > maximumNoticeBytes) {
        throw new Error(`notice file is too large: ${path}`);
      }
      sections.push(`--- ${file} ---`, text.trim());
    }
  }
  sections.push("", "");
}

writeFileSync(outputPath, `${sections.join("\n").trim()}\n`);
console.log(
  `Generated ${outputPath} for ${packageRoots.size} bundled packages`,
);

function formatLicense(license) {
  if (typeof license === "string") return license;
  if (Array.isArray(license)) {
    return license
      .map((entry) =>
        typeof entry === "string" ? entry : (entry?.type ?? "UNKNOWN"),
      )
      .join(" OR ");
  }
  if (license && typeof license === "object") return license.type ?? "UNKNOWN";
  return "UNKNOWN";
}
