import assert from "node:assert/strict";
import test from "node:test";
import { verifyRequiredChecks } from "./verify-pr-required-checks.mjs";

test("requires successful core checks when the core profile applies", () => {
  const failures = verifyRequiredChecks("core", "true", "true", {
    changes: "success",
    "prettier-check": "success",
    "get-packages-matrix": "success",
    "core-checks": "failure",
    "binary-checks": "success",
    "packages-checks": "success",
  });

  assert.deepEqual(failures, ["core-checks: expected success, got failure"]);
});

test("allows profile-filtered checks to skip only when the profile is false", () => {
  const results = {
    changes: "success",
    "prettier-check": "success",
    "get-packages-matrix": "success",
    "core-checks": "skipped",
    "binary-checks": "skipped",
    "packages-checks": "skipped",
  };

  assert.deepEqual(verifyRequiredChecks("core", "false", "true", results), []);
  assert.deepEqual(verifyRequiredChecks("core", "true", "true", results), [
    "core-checks: expected success, got skipped",
    "binary-checks: expected success, got skipped",
    "packages-checks: expected success, got skipped",
  ]);
});

test("does not allow cancellation to pass as a conditional skip", () => {
  const failures = verifyRequiredChecks("cli", "false", "false", {
    changes: "success",
    lint: "cancelled",
    test: "skipped",
    "runtime-guard": "skipped",
    "smoke-api": "skipped",
  });

  assert.deepEqual(failures, [
    "lint: expected success or conditionally skipped, got cancelled",
  ]);
});

test("requires smoke API success for same-repository core PRs", () => {
  const results = {
    changes: "success",
    lint: "success",
    test: "success",
    "runtime-guard": "success",
    "smoke-api": "skipped",
  };

  assert.deepEqual(verifyRequiredChecks("cli", "true", "true", results), [
    "smoke-api: expected success, got skipped",
  ]);
  assert.deepEqual(verifyRequiredChecks("cli", "true", "false", results), []);
});

test("fails closed for missing results and unknown workflow conditions", () => {
  assert.deepEqual(verifyRequiredChecks("cli", "unknown", "true", {}), [
    "cli_core: expected true or false",
  ]);
  assert.deepEqual(verifyRequiredChecks("unknown", "true", "true", {}), [
    "workflow: unsupported workflow (unknown)",
  ]);
});
