import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
    "lint: expected conditionally skipped, got cancelled",
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

test("binds every optional result to the actual profile, fork and actor conditions", () => {
  const results = {
    changes: "success",
    lint: "success",
    test: "success",
    "runtime-guard": "success",
    "smoke-api": "skipped",
  };
  assert.deepEqual(
    verifyRequiredChecks("cli", "true", "true", results, "true"),
    [],
  );
  assert.notDeepEqual(
    verifyRequiredChecks("cli", "true", "true", results, "false"),
    [],
  );
  assert.notDeepEqual(verifyRequiredChecks("cli", "true", "", results), []);
  assert.notDeepEqual(
    verifyRequiredChecks("cli", "true", "true", results, "unknown"),
    [],
  );
  assert.notDeepEqual(
    verifyRequiredChecks("cli", "false", "true", results),
    [],
  );
});

test("aggregate jobs checkout before repository scripts and independently recompute matching profiles", () => {
  for (const [file, name] of [
    ["pr-checks.yaml", "require-all-checks-to-pass"],
    ["cli-pr-checks.yml", "require-all-checks-to-pass-cli"],
  ]) {
    const workflow = fs.readFileSync(
      new URL(`../.github/workflows/${file}`, import.meta.url),
      "utf8",
    );
    const aggregate = workflow.split(`\n  ${name}:`)[1];
    assert.match(aggregate, /if: always\(\)/);
    assert.ok(
      aggregate.indexOf("uses: actions/checkout@") <
        aggregate.indexOf("run: node scripts/verify-pr-required-checks.mjs"),
    );
    assert.match(aggregate, /fetch-depth: 0/);
    assert.match(aggregate, /persist-credentials: false/);
    assert.match(
      aggregate,
      /uses: \.\/\.github\/actions\/detect-change-profiles/,
    );
    const heads = [...workflow.matchAll(/head-sha: (.+)/g)].map(
      (match) => match[1],
    );
    assert.equal(heads.length, 2);
    assert.equal(heads[0], heads[1]);
    assert.match(
      aggregate,
      /VERIFIED_CLI_CORE: \$\{\{ steps\.profiles\.outputs\.cli_core \}\}/,
    );
    if (file.startsWith("cli")) {
      const smoke = workflow.split("\n  smoke-api:")[1].split("\n  #")[0];
      assert.match(
        smoke,
        /if: needs\.changes\.outputs\.cli_core == 'true' && github\.event\.pull_request\.head\.repo\.full_name == github\.repository && github\.actor != 'dependabot\[bot\]'/,
      );
      assert.doesNotMatch(smoke, /\n        if:/);
    }
  }
});

test("validator runs with only a fresh checkout and rejects independently disproven skips", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "required-checks-"));
  try {
    const script = path.join(dir, "verify.mjs");
    fs.copyFileSync(
      new URL("./verify-pr-required-checks.mjs", import.meta.url),
      script,
    );
    const env = {
      CHECK_WORKFLOW: "cli",
      CLI_CORE: "false",
      VERIFIED_CLI_CORE: "false",
      SAME_REPOSITORY: "false",
      IS_DEPENDABOT: "false",
      RESULT_CHANGES: "success",
      RESULT_LINT: "skipped",
      RESULT_TEST: "skipped",
      RESULT_RUNTIME_GUARD: "skipped",
      RESULT_SMOKE_API: "skipped",
    };
    assert.equal(
      spawnSync(process.execPath, [script], { cwd: dir, env }).status,
      0,
    );
    const result = spawnSync(process.execPath, [script], {
      cwd: dir,
      env: { ...env, VERIFIED_CLI_CORE: "true" },
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /independently verified/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
