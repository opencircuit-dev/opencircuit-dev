import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  discoverAgents,
  isAllowedAgentPath,
  isTrustedAgentCaller,
  validateAgentPath,
} from "./verify-agent-path.mjs";

test("accepts only pushes to the repository default branch", () => {
  assert.equal(
    isTrustedAgentCaller(
      "opencircuit-dev/opencircuit-dev",
      "push",
      "refs/heads/main",
      "main",
    ),
    true,
  );
  assert.equal(
    isTrustedAgentCaller(
      "opencircuit-dev/opencircuit-dev",
      "pull_request",
      "refs/pull/10/merge",
      "main",
    ),
    false,
  );
  assert.equal(
    isTrustedAgentCaller(
      "opencircuit-dev/opencircuit-dev",
      "push",
      "refs/heads/feature",
      "main",
    ),
    false,
  );
  assert.equal(
    isTrustedAgentCaller("untrusted/fork", "push", "refs/heads/main", "main"),
    false,
  );
});

test("allows only reviewed paths from the fixed agent manifest", () => {
  assert.equal(
    isAllowedAgentPath(".ocircuit/agents/dependency-security-review.md"),
    true,
  );
  assert.equal(
    isAllowedAgentPath(".ocircuit/agents/review/security-1.md"),
    false,
  );

  for (const candidate of [
    "../outside.md",
    "/tmp/agent.md",
    ".ocircuit/agents/../../outside.md",
    ".ocircuit/agents/with space.md",
    ".ocircuit/agents/with'quote.md",
    ".ocircuit/agents/$(touch-marker).md",
    ".ocircuit/agents/line\nbreak.md",
    ".ocircuit/agents/not-markdown.txt",
  ]) {
    assert.equal(isAllowedAgentPath(candidate), false, candidate);
  }
});

test("validates existing regular files and rejects symlinks", () => {
  const workingDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "ocircuit-agent-path-"),
  );
  const agentsDirectory = path.join(workingDirectory, ".ocircuit", "agents");
  fs.mkdirSync(agentsDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(agentsDirectory, "breaking-change-detector.md"),
    "fixture",
  );
  fs.writeFileSync(path.join(workingDirectory, "outside.md"), "fixture");
  fs.symlinkSync(
    path.join(workingDirectory, "outside.md"),
    path.join(agentsDirectory, "dependency-security-review.md"),
  );

  try {
    assert.equal(
      validateAgentPath(
        ".ocircuit/agents/breaking-change-detector.md",
        workingDirectory,
      ),
      fs.realpathSync(
        path.join(agentsDirectory, "breaking-change-detector.md"),
      ),
    );
    assert.throws(
      () =>
        validateAgentPath(
          ".ocircuit/agents/dependency-security-review.md",
          workingDirectory,
        ),
      /symbolic link/,
    );
    assert.throws(() => discoverAgents(workingDirectory), /symbolic links/);
  } finally {
    fs.rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("discovers sorted approved Markdown paths only", () => {
  const workingDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "ocircuit-agent-discovery-"),
  );
  const agentsDirectory = path.join(workingDirectory, ".ocircuit", "agents");
  fs.mkdirSync(agentsDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(agentsDirectory, "error-message-quality.md"),
    "fixture",
  );
  fs.writeFileSync(
    path.join(agentsDirectory, "breaking-change-detector.md"),
    "fixture",
  );
  fs.writeFileSync(path.join(agentsDirectory, "notes.txt"), "ignored");

  try {
    assert.deepEqual(discoverAgents(workingDirectory), [
      ".ocircuit/agents/breaking-change-detector.md",
      ".ocircuit/agents/error-message-quality.md",
    ]);
  } finally {
    fs.rmSync(workingDirectory, { recursive: true, force: true });
  }
});

test("fails closed when discovery finds an unreviewed Markdown agent", () => {
  const workingDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "ocircuit-agent-unreviewed-"),
  );
  const agentsDirectory = path.join(workingDirectory, ".ocircuit", "agents");
  fs.mkdirSync(agentsDirectory, { recursive: true });
  fs.writeFileSync(path.join(agentsDirectory, "unreviewed.md"), "fixture");

  try {
    assert.throws(
      () => discoverAgents(workingDirectory),
      /outside the approved agent path format/,
    );
  } finally {
    fs.rmSync(workingDirectory, { recursive: true, force: true });
  }
});
