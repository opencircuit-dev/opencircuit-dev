#!/usr/bin/env node
/**
 * Phase 3, Item 6 — positive boundary conformance enforcement.
 *
 * Unlike `boundary-check.mjs` (a Phase 0 denylist retained-closure check), this
 * script enforces an *allowlist*: CLI production source may only import Core
 * through the declared public subpaths from
 * `docs/reduction/artifacts/phase3/item2-evidence.md`'s "Proposed API matrix",
 * as promoted and migrated in Item 4. Any other Core import surface is a
 * failure, so the boundary cannot silently regrow via new deep imports.
 *
 * Rejects:
 *  - Core filesystem aliases from production CLI code (relative imports that
 *    reach into `core/src` or `core/dist` instead of through the `core`/`core/*`
 *    package alias).
 *  - Undeclared subpath imports (any `core/<subpath>` not in the approved list).
 *  - New deep imports (any Core import not already accounted for below).
 *  - Unapproved compatibility imports after their tracked expiry (none are
 *    currently past expiry; see DEFERRED_SPECIFIERS).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const cliSourceRoot = path.join(repoRoot, "extensions/cli/src");
const sourceExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx"]);

// Approved per Item 2's "Proposed API matrix" (promoted + CLI-migrated in Item 4).
// Root import is types-only per Item 2's "Root `types`-only export note".
const APPROVED_ROOT_IMPORTS = new Set(["core", "core/index.js"]);
const APPROVED_SUBPATHS = new Set([
  "core/errors.js",
  "core/messageConversion.js",
  "core/chatDescriber.js",
  "core/globalContext.js",
  "core/editing.js",
  "core/security.js",
  "core/paths.js",
  "core/messageContent.js",
  "core/uri.js",
  "core/llm/calculateRequestCost.js",
  "core/llm/getAdjustedTokenCount.js",
]);

// Tracked per Item 2's "Excluded from this proposal" table — these remain
// unresolved pending Item 1's `Investigate` classification follow-up and are
// NOT permanently approved. They are allowed to persist only as this exact,
// enumerated set (no new deferred specifiers may be added without updating
// this list and re-justifying them against item1/item2 evidence); doing so
// keeps them visible instead of silently passing as if declared public.
const DEFERRED_SPECIFIERS = new Set([
  "core/util/history.js",
  "core/tools/implementations/fetchUrlContent.js",
  "core/config/markdown/utils.js",
]);

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

// A relative import that resolves into `core/` bypasses the declared
// `core`/`core/*` package alias entirely (a raw filesystem alias) and is
// always a violation, regardless of what it points at.
function isCoreFilesystemAlias(resolvedPath) {
  return (
    resolvedPath != null &&
    (resolvedPath === "core" || resolvedPath.startsWith("core/"))
  );
}

function classifySpecifier(specifier) {
  if (APPROVED_ROOT_IMPORTS.has(specifier)) {
    return "approved-root-types-only";
  }
  if (APPROVED_SUBPATHS.has(specifier)) {
    return "approved-subpath";
  }
  if (DEFERRED_SPECIFIERS.has(specifier)) {
    return "deferred-pending-investigation";
  }
  return "violation";
}

function inspectCliImports() {
  const observations = [];
  for (const filePath of walkFiles(cliSourceRoot)) {
    const content = fs.readFileSync(filePath, "utf8");
    for (const specifier of extractSpecifiers(content)) {
      const resolvedPath = resolveRepositoryPath(filePath, specifier);
      const isBareCoreImport = specifier === "core" || specifier.startsWith("core/");
      const isFilesystemAlias = isCoreFilesystemAlias(resolvedPath);

      if (!isBareCoreImport && !isFilesystemAlias) {
        continue;
      }

      const importer = repositoryRelative(filePath);
      if (isFilesystemAlias) {
        observations.push({
          importer,
          specifier,
          resolvedPath,
          classification: "core-filesystem-alias",
        });
        continue;
      }

      observations.push({
        importer,
        specifier,
        classification: classifySpecifier(specifier),
      });
    }
  }
  return observations;
}

const observations = inspectCliImports();
const violations = observations.filter(
  (observation) =>
    observation.classification === "violation" ||
    observation.classification === "core-filesystem-alias",
);
const deferred = observations.filter(
  (observation) => observation.classification === "deferred-pending-investigation",
);
const approved = observations.filter((observation) =>
  observation.classification.startsWith("approved"),
);

const report = {
  check: "phase3-item6-positive-cli-core-boundary",
  status: violations.length === 0 ? "pass" : "fail",
  allowlist: {
    approvedRootImports: [...APPROVED_ROOT_IMPORTS].sort(),
    approvedSubpaths: [...APPROVED_SUBPATHS].sort(),
    deferredSpecifiers: [...DEFERRED_SPECIFIERS].sort(),
  },
  summary: {
    approvedImportCount: approved.length,
    deferredImportCount: deferred.length,
    violationCount: violations.length,
  },
  deferred,
  violations,
  note:
    "Any Core import from CLI production source outside the approved allowlist " +
    "(or the tracked, unresolved deferred set from Item 2's exclusions) fails " +
    "this check. Widening the allowlist requires updating this script alongside " +
    "new Item 1/2-style evidence, not just editing an unrelated import site.",
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.status === "pass" ? 0 : 1;
