#!/usr/bin/env node

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const guardPath = "tests/characterization/retired-vscode-surface-guard.mjs";
const testPath = "tests/characterization/retired-vscode-surface-guard.test.mjs";
const scannedExtensions = new Set([
  ".cjs",
  ".js",
  ".json",
  ".mjs",
  ".ps1",
  ".sh",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
const retiredCompatibility = [
  /(?<![\w.-])extensions[\\/]vscode(?![\w.-])/i,
  /\bideType\s*===?\s*["']vscode["']/i,
  /\bgetExternalUri\b/,
  /\bvsc(?:MachineId|MediaUrl)\b/,
  /vscode\/(?:openMoveRightMarkdown)/i,
  /\bVsCodeMessenger\b/,
  /"type"\s*:\s*"extensionHost"/i,
  /(?:@vscode\/vsce|\bvsce\s+(?:package|publish))/i,
];
// Preserve narrow, existing Core compatibility points without grandfathering
// additional references in the same files.
const retainedCompatibilityLines = new Map([
  [
    "core/config/load.ts",
    new Set([
      'if (ideInfo.ideType === "vscode") {',
      'ideInfo.ideType === "vscode" &&',
    ]),
  ],
  [
    "core/config/profile/doLoadConfig.ts",
    new Set(['ideInfo.ideType === "vscode"']),
  ],
  [
    "core/config/yaml/loadYaml.ts",
    new Set([
      'if (ideInfo.ideType === "vscode") {',
      'ideInfo.ideType === "vscode" &&',
    ]),
  ],
  [
    "core/config/types.ts",
    new Set([
      "vscMachineId: string;",
      "vscMediaUrl: string;",
      "getExternalUri?(uri: string): Promise<string>;",
    ]),
  ],
  [
    "core/context/mcp/MCPOauth.ts",
    new Set([
      "// If IDE supports getExternalUri (VS Code extension), use it for dynamic redirect URI",
      "if (this.ide.getExternalUri) {",
      "const externalUri = await this.ide.getExternalUri(localUri);",
      'if (!this.ide.getExternalUri || this._redirectUrl.includes("localhost")) {',
    ]),
  ],
  [
    "core/index.d.ts",
    new Set([
      "vscMachineId: string;",
      "vscMediaUrl: string;",
      "getExternalUri?(uri: string): Promise<string>;",
    ]),
  ],
  [
    "core/protocol/ideWebview.ts",
    new Set([
      "vscMachineId: string;",
      "vscMediaUrl: string;",
      '"vscode/openMoveRightMarkdown": [undefined, void];',
    ]),
  ],
]);

export function findRetiredSurfaceViolations(files, readFile) {
  const violations = [];

  for (const file of files) {
    const normalizedFile = file.replaceAll("\\", "/");
    if (/(?:^|\/)extensions\/vscode(?:\/|$)/i.test(normalizedFile)) {
      violations.push(`retired extension path: ${normalizedFile}`);
    }
    if (/\.vsix$/i.test(normalizedFile)) {
      violations.push(`retired VSIX artifact: ${normalizedFile}`);
    }

    if (
      normalizedFile === guardPath ||
      normalizedFile === testPath ||
      /\.(?:test|spec|vitest)\.[^.]+$/i.test(normalizedFile) ||
      !scannedExtensions.has(path.extname(normalizedFile).toLowerCase())
    ) {
      continue;
    }

    const retainedLines = retainedCompatibilityLines.get(normalizedFile);
    const lines = readFile(file).split(/\r?\n/);
    let foundCompatibilityViolation = false;
    for (const line of lines) {
      if (retainedLines?.has(line.trim())) {
        continue;
      }
      for (const pattern of retiredCompatibility) {
        if (pattern.test(line)) {
          violations.push(
            `retired VS Code compatibility reference: ${normalizedFile}`,
          );
          foundCompatibilityViolation = true;
          break;
        }
      }
      if (foundCompatibilityViolation) break;
    }
  }

  return violations;
}

function checkRepository() {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  const violations = findRetiredSurfaceViolations(files, (file) =>
    fs.readFileSync(path.join(repositoryRoot, file), "utf8"),
  );

  if (violations.length > 0) {
    console.error(
      `Retired VS Code surface guard failed:\n${violations.map((item) => `- ${item}`).join("\n")}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    "Retired VS Code surface guard passed; generic .vscode contributor configuration is allowed.",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  checkRepository();
}
