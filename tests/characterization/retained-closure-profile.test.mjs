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
    "CLI bundled license and notice evidence",
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

test("retained-closure builds its release archive before checking it", () => {
  const build = validatorSource.indexOf('args: ["run", "release:artifact"]');
  const check = validatorSource.indexOf(
    'args: ["run", "check:release-artifact"]',
  );
  assert.ok(build >= 0, "clean validation must generate its own archive");
  assert.ok(check > build, "archive validation must follow archive generation");
});
