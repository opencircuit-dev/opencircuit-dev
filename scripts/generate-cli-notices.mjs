#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  cliRoot,
  collectBundledPackages,
  findNoticeFiles,
} from "./cli-bundle-closure.mjs";

const outputPath = resolve(cliRoot, "THIRD_PARTY_NOTICES.txt");
const maximumNoticeBytes = 1024 * 1024;

const { thirdParty } = collectBundledPackages();

const sections = [
  "Open Circuit CLI third-party notices",
  "",
  "This file is generated from extensions/cli/dist/meta.json during release packaging.",
  "It describes packages whose code is included in the bundled CLI.",
  "",
];
const withoutLicenseText = [];

for (const dependency of thirdParty) {
  const files = findNoticeFiles(dependency.root);
  sections.push(`${dependency.name}@${dependency.version}`);
  sections.push(`License: ${dependency.license}`);
  if (files.length === 0) {
    withoutLicenseText.push(`${dependency.name}@${dependency.version}`);
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
  `Generated ${outputPath} for ${thirdParty.length} bundled third-party packages`,
);
if (withoutLicenseText.length > 0) {
  console.warn(
    `${withoutLicenseText.length} bundled packages ship no license text: ${withoutLicenseText.join(", ")}`,
  );
}
