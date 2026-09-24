#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const coreRoot = path.join(repoRoot, "core");
const cliRoot = path.join(repoRoot, "extensions/cli");
const cliSourceRoot = path.join(cliRoot, "src");
const bundleMetadataPath = path.join(cliRoot, "dist/meta.json");

const deniedRepositoryPaths = [
  "extensions/cli/",
  "extensions/vscode/",
  "gui/",
  "binary/",
];
const deniedPackages = ["vscode", "@vscode/", "electron"];
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);

function walkFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      [
        "__mocks__",
        "__tests__",
        "dist",
        "e2e",
        "node_modules",
        "smoke-api",
        "test-helpers",
        "vendor",
      ].includes(entry.name)
    ) {
      continue;
    }
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (
      sourceExtensions.has(path.extname(entry.name)) &&
      !entry.name.includes(".test.") &&
      !entry.name.includes(".spec.") &&
      !entry.name.includes(".vitest.")
    ) {
      files.push(entryPath);
    }
  }
  return files;
}

function extractSpecifiers(content) {
  const specifiers = [];
  const patterns = [
    /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g,
    /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }
  return [...new Set(specifiers)];
}

function repositoryRelative(filePath) {
  return path.relative(repoRoot, filePath).split(path.sep).join("/");
}

function resolveRepositoryPath(importer, specifier) {
  if (!specifier.startsWith(".")) {
    return null;
  }
  return repositoryRelative(path.resolve(path.dirname(importer), specifier));
}

function matchesDeniedPath(candidate, deniedPaths = deniedRepositoryPaths) {
  const normalized = candidate.replaceAll("\\", "/").replace(/^\.\.\//, "");
  return deniedPaths.some(
    (deniedPath) =>
      normalized === deniedPath.slice(0, -1) ||
      normalized.startsWith(deniedPath) ||
      normalized.includes(`/${deniedPath}`),
  );
}

function matchesDeniedPackage(specifier) {
  return deniedPackages.some(
    (deniedPackage) =>
      specifier === deniedPackage ||
      specifier.startsWith(
        deniedPackage.endsWith("/") ? deniedPackage : `${deniedPackage}/`,
      ),
  );
}

function inspectForbiddenImports(sourceRoot, deniedPaths) {
  const violations = [];
  for (const filePath of walkFiles(sourceRoot)) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const specifier of extractSpecifiers(content)) {
      const resolvedPath = resolveRepositoryPath(filePath, specifier);
      if (
        matchesDeniedPackage(specifier) ||
        (resolvedPath && matchesDeniedPath(resolvedPath, deniedPaths))
      ) {
        violations.push({
          importer: repositoryRelative(filePath),
          specifier,
          resolvedPath,
        });
      }
    }
  }
  return violations;
}

function matchesDeniedBundlePackage(input) {
  const normalized = input.replaceAll("\\", "/");
  return deniedPackages.some((deniedPackage) => {
    const packagePath = deniedPackage.endsWith("/")
      ? deniedPackage.slice(0, -1)
      : deniedPackage;
    const dependencyPath = `node_modules/${packagePath}/`;
    return (
      normalized.startsWith(dependencyPath) ||
      normalized.includes(`/${dependencyPath}`)
    );
  });
}

function inspectCliDeepImports() {
  const observations = [];
  for (const filePath of walkFiles(cliSourceRoot)) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const specifier of extractSpecifiers(content)) {
      if (specifier === "core" || specifier.startsWith("core/")) {
        observations.push({
          importer: repositoryRelative(filePath),
          specifier,
          classification:
            specifier === "core" || specifier === "core/index.js"
              ? "root-or-declaration-import"
              : "deep-import",
        });
      }
    }
  }
  return observations;
}

function inspectBundleInputs() {
  if (!fs.existsSync(bundleMetadataPath)) {
    return {
      status: "missing",
      metadata: repositoryRelative(bundleMetadataPath),
      violations: [],
    };
  }

  const metadata = JSON.parse(fs.readFileSync(bundleMetadataPath, "utf8"));
  const violations = Object.keys(metadata.inputs ?? {})
    .map((input) => input.replaceAll("\\", "/"))
    .filter(
      (input) => matchesDeniedPath(input) || matchesDeniedBundlePackage(input),
    )
    .sort();

  return {
    status: violations.length === 0 ? "pass" : "fail",
    metadata: repositoryRelative(bundleMetadataPath),
    inputCount: Object.keys(metadata.inputs ?? {}).length,
    violations,
  };
}

const coreViolations = inspectForbiddenImports(coreRoot, deniedRepositoryPaths);
const cliViolations = inspectForbiddenImports(
  cliSourceRoot,
  deniedRepositoryPaths.filter(
    (deniedPath) => deniedPath !== "extensions/cli/",
  ),
);
const cliDeepImports = inspectCliDeepImports();
const bundle = inspectBundleInputs();
const failed =
  coreViolations.length > 0 ||
  cliViolations.length > 0 ||
  bundle.status !== "pass";

const report = {
  check: "phase0-cli-core-boundary",
  status: failed ? "fail" : "pass",
  denylist: {
    repositoryPaths: deniedRepositoryPaths,
    packages: deniedPackages,
  },
  staticSource: {
    status:
      coreViolations.length === 0 && cliViolations.length === 0
        ? "pass"
        : "fail",
    coreForbiddenImports: coreViolations,
    cliForbiddenImports: cliViolations,
    cliCoreImports: cliDeepImports,
    note: "CLI-to-Core imports are observed baseline evidence, not Phase 0 failures.",
  },
  emittedBundle: bundle,
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = failed ? 1 : 0;
