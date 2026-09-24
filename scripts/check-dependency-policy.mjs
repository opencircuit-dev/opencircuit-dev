#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packagePath = path.resolve(process.cwd(), "package.json");
const lockPath = path.resolve(process.cwd(), "package-lock.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const lockJson = JSON.parse(fs.readFileSync(lockPath, "utf8"));
const errors = [];
const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const exactScriptKey =
  /^(?:[^@/]+|@[^/]+\/[^@]+)@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

// Locate the repository's packages/ directory relative to this script, not
// the caller's cwd, since this script runs from core/, extensions/cli/, and
// packages/* with different working directories.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = path.join(repoRoot, "packages");
const localPackageNames = new Map();
if (fs.existsSync(packagesDir)) {
  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidatePackageJson = path.join(packagesDir, entry.name, "package.json");
    if (!fs.existsSync(candidatePackageJson)) continue;
    const candidateName = JSON.parse(
      fs.readFileSync(candidatePackageJson, "utf8"),
    ).name;
    if (candidateName) localPackageNames.set(candidateName, entry.name);
  }
}

for (const section of dependencySections) {
  for (const dependencyName of Object.keys(packageJson[section] ?? {})) {
    if (dependencyName.startsWith("@continuedev/")) {
      errors.push(
        `${section} contains pre-rename package ${dependencyName}; use @opencircuit/*`,
      );
    }

    // A repo-local package (anything under packages/*) is never published to
    // the public npm registry. Declaring it as a registry semver range
    // resolves fine wherever npm's workspace linking silently satisfies it
    // (e.g. root-level installs), but fails with a registry 404 the moment
    // it's installed from a directory that isn't a workspace member (e.g.
    // core/, which has its own standalone lockfile) - see PR #67.
    if (localPackageNames.has(dependencyName) && dependencyName !== packageJson.name) {
      const declared = packageJson[section][dependencyName];
      if (!declared.startsWith("file:")) {
        errors.push(
          `${section}.${dependencyName} must use a file: reference to ` +
            `packages/${localPackageNames.get(dependencyName)} (repo-local package, ` +
            `never published to npm); found "${declared}"`,
        );
      }
    }
  }
}

for (const [packageName, allowed] of Object.entries(
  packageJson.allowScripts ?? {},
)) {
  if (allowed !== true || !exactScriptKey.test(packageName)) {
    errors.push(
      `allowScripts entry ${packageName} must be true and exact version-pinned`,
    );
  }
}

if (packageJson.name === "@opencircuit/core") {
  const override = packageJson.overrides?.["@tootallnate/once"];
  const lockEntry =
    lockJson.packages?.["node_modules/@tootallnate/once"]?.version;
  if (override !== "2.0.1") {
    errors.push(
      `Core @tootallnate/once override must remain exact 2.0.1; found ${override ?? "missing"}`,
    );
  }
  if (lockEntry !== "2.0.1") {
    errors.push(
      `Core lockfile must resolve @tootallnate/once to 2.0.1; found ${lockEntry ?? "missing"}`,
    );
  }
  console.log(
    "Temporary upstream-chain workaround monitored: @tootallnate/once 2.0.1.",
  );
}

if (errors.length > 0) {
  console.error("Dependency policy check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Dependency policy passed for ${packageJson.name}.`);
}
