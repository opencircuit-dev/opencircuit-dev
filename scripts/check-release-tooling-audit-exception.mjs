#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const severityRank = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };

function assertCompleteAudit(audit) {
  if (
    audit.error ||
    !audit.vulnerabilities ||
    !audit.metadata?.vulnerabilities
  ) {
    throw new Error(
      "npm audit did not return a complete vulnerability report.",
    );
  }
}

function collectAdvisoryUrls(value, urls = new Set()) {
  if (!value || typeof value !== "object") return urls;
  if (typeof value.url === "string") urls.add(value.url);
  for (const child of Object.values(value)) collectAdvisoryUrls(child, urls);
  return urls;
}

function assertPolicy(policy) {
  if (
    policy?.schemaVersion !== "open-circuit.release-tooling-audit.v1" ||
    !policy.expiresOn ||
    !policy.exitPath ||
    !policy.advisories ||
    !policy.packages
  ) {
    throw new Error("Release-tooling audit policy is incomplete.");
  }
  if (Date.parse(`${policy.expiresOn}T23:59:59Z`) < Date.now()) {
    throw new Error(
      `Release-tooling audit policy expired on ${policy.expiresOn}.`,
    );
  }
}

export function assertCleanAudit(audit, context = {}) {
  assertCompleteAudit(audit);
  const names = Object.keys(audit.vulnerabilities);
  const total = audit.metadata.vulnerabilities.total;
  if (!names.length && total === 0) return { exceptionApplied: false };

  const { policy, lock } = context;
  if (!policy || !lock) {
    throw new Error(
      `Tooling audit findings are not permitted: ${names.join(", ")}.`,
    );
  }
  assertPolicy(policy);
  const findings = audit.vulnerabilities;
  const disallowedSeverity = names.filter(
    (name) =>
      severityRank[findings[name].severity] >
      severityRank[policy.maxSeverity ?? "moderate"],
  );
  if (disallowedSeverity.length) {
    throw new Error(
      `Release-tooling audit has disallowed severity findings: ${disallowedSeverity.join(", ")}.`,
    );
  }

  const expectedNames = Object.keys(policy.packages).sort();
  const actualNames = [...names].sort();
  if (JSON.stringify(expectedNames) !== JSON.stringify(actualNames)) {
    throw new Error(
      `Release-tooling audit findings changed. Expected ${expectedNames.join(", ")}; got ${actualNames.join(", ")}.`,
    );
  }

  const mismatches = [];
  for (const name of names) {
    const finding = findings[name];
    const allowedVersions = policy.packages[name];
    for (const node of finding.nodes ?? []) {
      const version = lock.packages?.[node]?.version;
      if (!version || !allowedVersions.includes(version)) {
        mismatches.push(`${name}@${version ?? "unknown"}`);
      }
    }
    if (!finding.nodes?.length) mismatches.push(`${name}@unknown`);
  }
  if (mismatches.length) {
    throw new Error(
      `Release-tooling audit versions changed: ${mismatches.join(", ")}.`,
    );
  }

  const unexpectedAdvisories = [...collectAdvisoryUrls(findings)].filter(
    (url) => !policy.advisories.includes(url),
  );
  if (unexpectedAdvisories.length) {
    throw new Error(
      `Release-tooling audit advisories changed: ${unexpectedAdvisories.join(", ")}.`,
    );
  }
  return {
    exceptionApplied: true,
    expiresOn: policy.expiresOn,
    exitPath: policy.exitPath,
    findings: names,
  };
}

function loadPolicy(repositoryRoot, workingDirectory) {
  const relative = path.relative(repositoryRoot, workingDirectory);
  const profile =
    relative === "" ? "root" : relative === "extensions/cli" ? "cli" : null;
  if (!profile) {
    throw new Error(
      `Unsupported release-tooling audit working directory: ${workingDirectory}`,
    );
  }
  const policyPath = path.join(
    repositoryRoot,
    "scripts",
    "release-tooling-audit-policy.json",
  );
  const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
  const profilePolicy = policy.profiles?.[profile];
  if (!profilePolicy)
    throw new Error(`Missing release-tooling audit profile: ${profile}.`);
  return profilePolicy;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const workingDirectory = process.cwd();
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["audit", "--json", "--include=dev", "--include=optional"],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  const audit = JSON.parse(result.stdout);
  const lock = JSON.parse(
    fs.readFileSync(path.join(workingDirectory, "package-lock.json"), "utf8"),
  );
  const outcome = assertCleanAudit(audit, {
    lock,
    policy: loadPolicy(repositoryRoot, workingDirectory),
  });
  if (result.status !== 0 && !outcome.exceptionApplied)
    throw new Error(`npm audit failed with exit ${result.status}.`);
  console.log(
    outcome.exceptionApplied
      ? `Release tooling audit passed with a bounded development-only exception through ${outcome.expiresOn}.`
      : "Release tooling audit passed with zero vulnerabilities.",
  );
}
