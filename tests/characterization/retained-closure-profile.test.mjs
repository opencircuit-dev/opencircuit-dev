import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

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

test("CLI CI tests each supported Ubuntu release with the runtime boundary gate", async () => {
  const workflow = YAML.parse(
    await fs.readFile(
      path.join(repositoryRoot, ".github/workflows/cli-pr-checks.yml"),
      "utf8",
    ),
  );
  const job = workflow.jobs.test;
  assert.deepEqual(job.strategy.matrix.os, [
    "ubuntu-22.04",
    "ubuntu-24.04",
    "ubuntu-26.04",
  ]);
  const boundary = job.steps.find((step) =>
    step.run?.includes("npm run test:runtime-boundary"),
  );
  assert.ok(boundary, "runtime boundary gate must be present");
  assert.equal(boundary.if, undefined, "all Ubuntu releases need the gate");
});

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

test("release validation builds the current archive before inspecting it", async () => {
  const workflow = await fs.readFile(
    path.join(repositoryRoot, ".github/workflows/cli-pr-checks.yml"),
    "utf8",
  );
  for (const [source, build, check] of [
    [
      validatorSource,
      'args: ["run", "release:artifact"]',
      'args: ["run", "check:release-artifact"]',
    ],
    [workflow, "npm run release:artifact", "npm run check:release-artifact"],
  ]) {
    assert.ok(source.indexOf(build) >= 0, "archive build must be present");
    assert.ok(
      source.indexOf(check) > source.indexOf(build),
      "archive validation must follow the build",
    );
  }
});
