import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const validatorPath = path.join(
  repositoryRoot,
  "scripts",
  "validate-retained-closure.mjs",
);
const validatorSource = await fs.readFile(validatorPath, "utf8");

test("retained-closure validation covers the retained CLI/Core product surface", () => {
  for (const step of [
    "Root production audit",
    "Core build",
    "Core typecheck",
    "CLI typecheck",
    "CLI smoke tests",
    "CLI-Core runtime boundary",
    "CLI release artifact",
  ]) {
    assert.match(validatorSource, new RegExp(`name: "${step}"`));
  }
});

test("retained-closure validation has no orphaned Rust sync surface", () => {
  assert.doesNotMatch(validatorSource, /cargo|rust-toolchain|scripts\/sync/);
  assert.doesNotMatch(validatorSource, /\bsync\b/);
});
