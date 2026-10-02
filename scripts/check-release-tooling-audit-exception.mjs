#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const exceptionPath = path.join(
  repositoryRoot,
  "scripts",
  "dependency-audit-exceptions.json",
);
const exception = JSON.parse(fs.readFileSync(exceptionPath, "utf8"));
const today = new Date().toISOString().slice(0, 10);

if (today > exception.expiresOn) {
  throw new Error(
    `Release-tooling audit exception expired on ${exception.expiresOn}; ` +
      `follow the exit path: ${exception.exitPath}`,
  );
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(
  npmCommand,
  ["audit", "--json", "--include=dev", "--include=optional"],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let audit;
try {
  audit = JSON.parse(result.stdout);
} catch {
  throw new Error(
    `npm audit did not return JSON (exit ${result.status ?? "unknown"}).\n` +
      result.stderr.trim(),
  );
}

const findings = new Map(
  exception.findings.map((finding) => [finding.name, finding]),
);
const vulnerabilities = audit.vulnerabilities ?? {};
const vulnerabilityNames = Object.keys(vulnerabilities).sort();
const expectedNames = [...findings.keys()].sort();

if (JSON.stringify(vulnerabilityNames) !== JSON.stringify(expectedNames)) {
  throw new Error(
    `Unexpected release-tooling audit findings. Expected ${expectedNames.join(
      ", ",
    )}; received ${vulnerabilityNames.join(", ") || "none"}.`,
  );
}

const packageJsonPath = path.join(
  process.cwd(),
  exception.parent.path,
  "package.json",
);
const parentPackage = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
if (parentPackage.name !== exception.parent.name) {
  throw new Error(
    `Unexpected audit parent package: ${parentPackage.name}; expected ${exception.parent.name}.`,
  );
}
if (parentPackage.version !== exception.parent.version) {
  throw new Error(
    `Unexpected ${exception.parent.name} version: ${parentPackage.version}; expected ${exception.parent.version}.`,
  );
}

for (const finding of exception.findings) {
  const vulnerability = vulnerabilities[finding.name];
  const nodes = vulnerability.nodes ?? [];
  if (nodes.length !== 1 || nodes[0] !== finding.path) {
    throw new Error(
      `Unexpected ${finding.name} paths: ${nodes.join(", ") || "none"}; expected ${finding.path}.`,
    );
  }

  const actualAdvisories = (vulnerability.via ?? [])
    .filter((entry) => typeof entry === "object" && entry.url)
    .map((entry) => entry.url)
    .sort();
  const expectedAdvisories = [...finding.advisories].sort();
  if (JSON.stringify(actualAdvisories) !== JSON.stringify(expectedAdvisories)) {
    throw new Error(
      `Unexpected ${finding.name} advisories; expected ${expectedAdvisories.join(
        ", ",
      )}; received ${actualAdvisories.join(", ") || "none"}.`,
    );
  }

  const packageJson = JSON.parse(
    fs.readFileSync(
      path.join(process.cwd(), finding.path, "package.json"),
      "utf8",
    ),
  );
  if (packageJson.version !== finding.version) {
    throw new Error(
      `Unexpected ${finding.name} version: ${packageJson.version}; expected ${finding.version}.`,
    );
  }
}

console.log(
  `Release-tooling audit exception passed through ${exception.expiresOn}; ` +
    `${exception.findings.length} pinned npm bundle findings remain under review.`,
);
