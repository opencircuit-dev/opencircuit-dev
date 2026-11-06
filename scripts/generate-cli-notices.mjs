#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  cliRoot,
  collectBundledPackages,
  findNoticeFiles,
  repositoryRoot,
} from "./cli-bundle-closure.mjs";

const outputPath = resolve(cliRoot, "THIRD_PARTY_NOTICES.txt");
const evidencePath = resolve(repositoryRoot, "scripts/license-evidence.json");
const maximumNoticeBytes = 1024 * 1024;

const { thirdParty } = collectBundledPackages();
const evidenceManifest = JSON.parse(readFileSync(evidencePath, "utf8"));
if (evidenceManifest.schemaVersion !== "open-circuit.license-evidence.v1") {
  throw new Error("unsupported license evidence schema");
}
const evidenceByPackage = new Map(
  evidenceManifest.entries.map((entry) => [
    `${entry.name}@${entry.version}`,
    entry,
  ]),
);

const sections = [
  "Open Circuit CLI third-party notices",
  "",
  "This file is generated from the bundled CLI and its published install-time dependency tree.",
  "It describes packages included in the bundle or fetched by npm for end users.",
  "",
];
for (const dependency of thirdParty) {
  const files = findNoticeFiles(dependency.root);
  sections.push(`${dependency.name}@${dependency.version}`);
  sections.push(`License: ${dependency.license}`);
  const packageKey = `${dependency.name}@${dependency.version}`;
  const evidence = evidenceByPackage.get(packageKey);
  if (evidence) {
    validateEvidence(evidence, dependency);
  }
  if (files.length === 0) {
    if (!evidence) {
      throw new Error(`missing authoritative license evidence: ${packageKey}`);
    }
    const licenseTextPath = resolve(repositoryRoot, evidence.licenseTextPath);
    const licenseText = readFileSync(licenseTextPath, "utf8");
    const licenseTextSha256 = createHash("sha256")
      .update(licenseText)
      .digest("hex");
    if (licenseTextSha256 !== evidence.licenseTextSha256) {
      throw new Error(`license evidence hash mismatch: ${packageKey}`);
    }
    sections.push(
      `Evidence source: ${evidence.sourceUrl}`,
      `Evidence ref: ${evidence.sourceRef}`,
      `License text SHA-256: ${licenseTextSha256}`,
      `--- ${evidence.licenseTextPath} ---`,
      normalizeNoticeText(licenseText),
    );
  } else {
    for (const file of files) {
      const path = resolve(dependency.root, file);
      const text = readFileSync(path, "utf8");
      if (Buffer.byteLength(text) > maximumNoticeBytes) {
        throw new Error(`notice file is too large: ${path}`);
      }
      sections.push(`--- ${file} ---`, normalizeNoticeText(text));
    }
  }
  sections.push("", "");
}

writeFileSync(outputPath, `${sections.join("\n").trim()}\n`);
console.log(
  `Generated ${outputPath} for ${thirdParty.length} CLI release-closure third-party packages`,
);

function normalizeNoticeText(text) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function validateEvidence(evidence, dependency) {
  const packageKey = `${dependency.name}@${dependency.version}`;
  if (
    evidence.spdx !== dependency.license ||
    typeof evidence.sourceUrl !== "string" ||
    typeof evidence.sourceRef !== "string" ||
    typeof evidence.licenseTextPath !== "string" ||
    !/^[a-f0-9]{64}$/.test(evidence.licenseTextSha256)
  ) {
    throw new Error(`incomplete license evidence: ${packageKey}`);
  }
  const licenseTextPath = resolve(repositoryRoot, evidence.licenseTextPath);
  const licenseText = readFileSync(licenseTextPath, "utf8");
  const licenseTextSha256 = createHash("sha256")
    .update(licenseText)
    .digest("hex");
  if (licenseTextSha256 !== evidence.licenseTextSha256) {
    throw new Error(`license evidence hash mismatch: ${packageKey}`);
  }
}
