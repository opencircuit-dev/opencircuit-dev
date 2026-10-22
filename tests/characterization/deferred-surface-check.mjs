#!/usr/bin/env node

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const retiredPaths = [
  ".vscode",
  "core/.vscode",
  "sync/.vscode",
  ".ocircuit/rules/vs-code-commands-helper-functions.md",
  "extensions/vscode",
];

const pathViolations = retiredPaths
  .filter((relativePath) =>
    fs.existsSync(path.join(repositoryRoot, relativePath)),
  )
  .map((relativePath) => "retired path exists: " + relativePath);

const trackedFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { cwd: repositoryRoot, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);

const trackedPathViolations = trackedFiles
  .filter((file) =>
    /(?:^|\/)\.vscode(?:\/|$)|(?:^|\/)extensions\/vscode(?:\/|$)|\.vsix$/.test(
      file,
    ),
  )
  .map((file) => "retired path is tracked: " + file);

const forbiddenCompatibility = [
  /\bideType\s*===?\s*["']vscode["']/i,
  /\bgetExternalUri\b/,
  /\bvsc(?:MachineId|MediaUrl)\b/,
  /vscode\/(?:openMoveRightMarkdown)/i,
  /(?:vscode-remote|vscode-vfs):\/\//i,
  /extensions\/vscode\//i,
  /VsCodeMessenger/i,
  /\.vscode\/(?:tasks|launch|settings|mcp)\.json/i,
];

const excludedFiles = new Set([
  "tests/characterization/deferred-surface-check.mjs",
  "tests/characterization/retired-vscode-surface-guard.mjs",
  "tests/characterization/retired-vscode-surface-guard.test.mjs",
  "TEST_SKIP_DECISIONS.md",
  "binary/build.js",
  "core/indexing/ignore.ts",
  "core/autocomplete/context/static-context/StaticContextService.ts",
  "extensions/cli/src/util/filePatterns.ts",
  "sync/src/sync/merkle.rs",
]);

const contentViolations = [];
for (const relativeFile of trackedFiles) {
  if (excludedFiles.has(relativeFile)) continue;
  if (
    ![".js", ".mjs", ".ts", ".tsx", ".md", ".yml", ".yaml", ".sh", ".ps1"].some(
      (extension) => relativeFile.endsWith(extension),
    )
  ) {
    continue;
  }
  const content = fs.readFileSync(
    path.join(repositoryRoot, relativeFile),
    "utf8",
  );
  if (forbiddenCompatibility.some((pattern) => pattern.test(content))) {
    contentViolations.push("retired compatibility reference: " + relativeFile);
  }
}

const violations = [
  ...pathViolations,
  ...trackedPathViolations,
  ...contentViolations,
];

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    "Deferred surface guard passed: no retired VS Code surface remains.",
  );
}
