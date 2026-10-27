#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function assertCleanAudit(audit) {
  if (
    audit.error ||
    !audit.vulnerabilities ||
    !audit.metadata?.vulnerabilities
  ) {
    throw new Error(
      "npm audit did not return a complete vulnerability report.",
    );
  }
  const names = Object.keys(audit.vulnerabilities);
  if (names.length || audit.metadata.vulnerabilities.total !== 0) {
    throw new Error(
      `Tooling audit findings are not permitted: ${names.join(", ")}.`,
    );
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["audit", "--json", "--include=dev", "--include=optional"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  const audit = JSON.parse(result.stdout);
  assertCleanAudit(audit);
  if (result.status !== 0)
    throw new Error(`npm audit failed with exit ${result.status}.`);
  console.log(
    "Release tooling audit passed with zero vulnerabilities and no exceptions.",
  );
}
