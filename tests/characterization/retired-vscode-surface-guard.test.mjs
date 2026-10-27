import assert from "node:assert/strict";
import test from "node:test";

import { findRetiredSurfaceViolations } from "./retired-vscode-surface-guard.mjs";

function scanFixtures(fixtures) {
  return findRetiredSurfaceViolations(
    Object.keys(fixtures),
    (file) => fixtures[file],
  );
}

test("allows generic VS Code contributor settings and MCP configuration", () => {
  const violations = scanFixtures({
    ".vscode/settings.json": '{"editor.formatOnSave": true}',
    ".vscode/mcp.json": '{"servers": {}}',
    ".vscode/tasks.json": '{"tasks": [{"label": "cli:test"}]}',
    "extensions/cli/README.md":
      "The CLI can be used from a VS Code integrated terminal.",
    "core/tools/remoteWorkspace.ts":
      '"vscode-remote://wsl+Ubuntu/home/user/project"',
    "core/config/types.ts":
      "vscMachineId: string;\ngetExternalUri?(uri: string): Promise<string>;",
  });

  assert.deepEqual(violations, []);
});

test("rejects retired extension directories and VSIX artifacts", () => {
  const violations = scanFixtures({
    "extensions/vscode/package.json": "{}",
    "release/OpenCircuit.vsix": "binary",
  });

  assert.deepEqual(violations, [
    "retired extension path: extensions/vscode/package.json",
    "retired VSIX artifact: release/OpenCircuit.vsix",
  ]);
});

for (const content of [
  '{"cwd":"extensions/vscode"}',
  "cd extensions/vscode && npm run package",
  '"${workspaceFolder}/extensions/vscode"',
  '"./extensions/vscode/package.json"',
  "cd extensions\\vscode; npm run build",
]) {
  test(`rejects retired path reference: ${content}`, () => {
    const violations = scanFixtures({ "scripts/build.sh": content });

    assert.equal(violations.length, 1);
    assert.match(violations[0], /retired VS Code compatibility reference/);
  });
}

test("allows similarly named paths that are not the retired directory", () => {
  for (const content of [
    "cd otherextensions/vscode",
    "cd extensions/vscode-tools",
    "cd extensions/vscode_helpers",
    "cd extensions/vscode.json",
  ]) {
    assert.deepEqual(scanFixtures({ "scripts/build.sh": content }), []);
  }
});

for (const [description, content] of [
  ["extension-host launch configuration", '"type": "extensionHost"'],
  ["VS Code messenger compatibility", "new VsCodeMessenger()"],
  [
    "new external URI compatibility API",
    "getExternalUri(uri: string): Promise<string>;",
  ],
  ["extension packaging command", "vsce package"],
]) {
  test(`rejects ${description}`, () => {
    const violations = scanFixtures({
      "scripts/active-config.json": content,
    });

    assert.equal(violations.length, 1);
    assert.match(violations[0], /retired VS Code compatibility reference/);
  });
}

test("does not allow new compatibility references in retained API files", () => {
  const violations = scanFixtures({
    "core/config/types.ts":
      "vscMachineId: string;\ngetExternalUri(uri: string): Promise<string>;",
  });

  assert.equal(violations.length, 1);
  assert.match(violations[0], /retired VS Code compatibility reference/);
});

test("does not scan historical markdown references", () => {
  const violations = scanFixtures({
    "docs/history.md": "The former extension used VsCodeMessenger.",
  });

  assert.deepEqual(violations, []);
});
