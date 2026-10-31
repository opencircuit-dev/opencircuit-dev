import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  planRelease,
  recommendRelease,
  releasePackage,
} from "../../scripts/release-package.mjs";
import { assertCleanAudit } from "../../scripts/check-release-tooling-audit-exception.mjs";

test("tooling audit rejects findings, errors, and incomplete reports", () => {
  assert.doesNotThrow(() =>
    assertCleanAudit({
      vulnerabilities: {},
      metadata: { vulnerabilities: { total: 0 } },
    }),
  );
  assert.throws(() => assertCleanAudit({}), /complete vulnerability report/);
  assert.throws(
    () => assertCleanAudit({ error: { code: "E401" } }),
    /complete vulnerability report/,
  );
  assert.throws(
    () =>
      assertCleanAudit({
        vulnerabilities: { braces: {} },
        metadata: { vulnerabilities: { total: 1 } },
      }),
    /not permitted/,
  );
});

test("tooling audit exception is bounded to its exact policy", () => {
  const policy = {
    schemaVersion: "open-circuit.release-tooling-audit.v1",
    expiresOn: "2099-01-01",
    maxSeverity: "moderate",
    exitPath: "replace the tooling",
    advisories: ["https://github.com/advisories/example"],
    packages: { example: ["1.2.3"] },
  };
  const lock = {
    packages: { "node_modules/example": { version: "1.2.3" } },
  };
  assert.deepEqual(
    assertCleanAudit(
      {
        vulnerabilities: {
          example: {
            severity: "moderate",
            nodes: ["node_modules/example"],
            via: [{ url: "https://github.com/advisories/example" }],
          },
        },
        metadata: { vulnerabilities: { total: 1 } },
      },
      { policy, lock },
    ),
    {
      exceptionApplied: true,
      expiresOn: "2099-01-01",
      exitPath: "replace the tooling",
      findings: ["example"],
    },
  );
  assert.throws(
    () =>
      assertCleanAudit(
        {
          vulnerabilities: {
            example: {
              severity: "moderate",
              nodes: ["node_modules/example"],
              via: [],
            },
          },
          metadata: { vulnerabilities: { total: 1 } },
        },
        {
          policy,
          lock: { packages: { "node_modules/example": { version: "9.9.9" } } },
        },
      ),
    /versions changed/,
  );
});

test("preserves CLI patch-only feature rules and ignored commit types", () => {
  assert.deepEqual(recommendRelease([{ type: "feat", notes: [] }], "cli"), {
    level: 2,
  });
  assert.deepEqual(recommendRelease([{ type: "feat", notes: [{}] }], "cli"), {
    level: 2,
  });
  assert.deepEqual(recommendRelease([{ type: "docs", notes: [] }], "cli"), {});
  assert.deepEqual(recommendRelease([], "cli"), {});
});

test("preserves shared package scope, breaking, and default rules", () => {
  assert.deepEqual(
    recommendRelease(
      [{ type: "feat", scope: "packages/fetch", notes: [] }],
      "fetch",
    ),
    { level: 2 },
  );
  assert.deepEqual(
    recommendRelease(
      [{ type: "feat", scope: "packages/config-yaml", notes: [] }],
      "fetch",
    ),
    { level: 1 },
  );
  assert.deepEqual(
    recommendRelease(
      [{ type: "fix", scope: "packages/fetch", notes: [{}] }],
      "fetch",
    ),
    { level: 0 },
  );
  assert.deepEqual(
    recommendRelease([{ type: "feat", scope: "other", notes: [] }], "fetch"),
    { level: 1 },
  );
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ocircuit-release-"));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "--initial-branch=main");
  git("config", "user.name", "Release Test");
  git("config", "user.email", "release-test@example.invalid");
  git(
    "remote",
    "add",
    "origin",
    "https://github.com/opencircuit-dev/opencircuit-dev.git",
  );
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@opencircuit/fetch", version: "1.6.0" }),
  );
  git("add", "package.json");
  git("commit", "-m", "chore: initial package");
  git("tag", "@opencircuit/fetch@1.6.0");
  git(
    "commit",
    "--allow-empty",
    "-m",
    "feat(packages/fetch): retain streaming responses",
  );
  return { root, git };
}

test("plans package tags and notes without changing files, tags, or HEAD", async () => {
  const { root, git } = fixture();
  try {
    const head = git("rev-parse", "HEAD");
    git("tag", "v99.0.0");
    const plan = await planRelease(root);
    assert.equal(plan.version, "1.6.1");
    assert.equal(plan.tag, "@opencircuit/fetch@1.6.1");
    assert.match(plan.notes, /retain streaming responses/);
    await releasePackage(["--dry-run"], root);
    assert.equal(git("status", "--porcelain"), "");
    assert.equal(git("rev-parse", "HEAD"), head);
    assert.equal(git("tag", "--list"), "@opencircuit/fetch@1.6.0\nv99.0.0");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects publication outside Actions/main and rejects ambiguous flags", async () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/release-package.mjs", "--execute"],
    {
      encoding: "utf8",
      env: { ...process.env, GITHUB_ACTIONS: "false" },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Publishing requires GitHub Actions on main/);
  await assert.rejects(
    releasePackage(["--execute", "--dry-run"]),
    /Use --dry-run/,
  );
});

test("does not release when only ignored commits follow the package tag", async () => {
  const { root, git } = fixture();
  try {
    git("tag", "@opencircuit/fetch@1.6.1");
    git("commit", "--allow-empty", "-m", "docs: explain the release process");
    assert.equal(await planRelease(root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("publishing uses the validated plan and never pushes the source branch", () => {
  const { root, git } = fixture();
  try {
    const bin = path.join(root, "mock-bin");
    const log = path.join(root, "commands.jsonl");
    const realGit = spawnSync("which", ["git"], {
      encoding: "utf8",
    }).stdout.trim();
    const script = path.resolve("scripts/release-package.mjs");
    fs.mkdirSync(bin);
    const shim = `#!${process.execPath}
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
if (command === "git" && !["ls-remote", "push"].includes(args[0])) {
  const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ command, args }) + "\\n");
`;
    for (const command of ["git", "npm", "gh"]) {
      fs.writeFileSync(path.join(bin, command), shim, { mode: 0o755 });
    }
    git("add", "mock-bin");
    git("commit", "-m", "test: install isolated release command shims");
    const result = spawnSync(process.execPath, [script, "--execute"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        GITHUB_ACTIONS: "true",
        GITHUB_REF: "refs/heads/main",
        GITHUB_SERVER_URL: "https://github.com",
        GITHUB_REPOSITORY: "opencircuit-dev/opencircuit-dev",
        GITHUB_TOKEN: "fixture-only-placeholder",
        NPM_TOKEN: "fixture-only-placeholder",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const commands = fs
      .readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const pushes = commands.filter(
      (entry) => entry.command === "git" && entry.args[0] === "push",
    );
    assert.deepEqual(
      pushes.map((entry) => entry.args),
      [["push", "origin", "refs/tags/@opencircuit/fetch@1.6.1"]],
    );
    const npmCommands = commands.filter((entry) => entry.command === "npm");
    assert.deepEqual(
      npmCommands.map((entry) => entry.args[0]),
      ["version", "run", "publish"],
    );
    assert.ok(npmCommands[0].args.includes("--ignore-scripts"));
    assert.ok(npmCommands[2].args.includes("--ignore-scripts"));
    const release = commands.find(
      (entry) => entry.command === "gh" && entry.args[0] === "release",
    );
    assert.ok(release.args.includes("--verify-tag"));
    assert.ok(
      release.args.includes("github.com/opencircuit-dev/opencircuit-dev"),
    );
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /fixture-only-placeholder/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("rejects public npm publication from another fork before mutations", () => {
  const { root, git } = fixture();
  try {
    const result = spawnSync(
      process.execPath,
      [path.resolve("scripts/release-package.mjs"), "--execute"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_ACTIONS: "true",
          GITHUB_REF: "refs/heads/main",
          GITHUB_SERVER_URL: "https://github.enterprise.invalid",
          GITHUB_REPOSITORY: "example/private-fork",
          GITHUB_TOKEN: "fixture-only-placeholder",
          NPM_TOKEN: "fixture-only-placeholder",
        },
      },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unexpected release repository/);
    assert.equal(git("status", "--porcelain"), "");
    assert.equal(git("tag", "--list"), "@opencircuit/fetch@1.6.0");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
