#!/usr/bin/env node

import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const skipInstall = process.argv.includes("--skip-install");

for (const generatedDirectory of ["core/dist", "extensions/cli/dist"]) {
  const directory = path.join(repositoryRoot, generatedDirectory);
  fs.rmSync(directory, { recursive: true, force: true });
  console.log("[retained-closure] cleaned " + generatedDirectory);
}

const commands = [
  ...(!skipInstall
    ? [
        {
          name: "root dependencies",
          command: npmCommand,
          args: ["ci", "--no-audit", "--no-fund"],
          cwd: repositoryRoot,
        },
      ]
    : []),
  {
    name: "shared package builds",
    command: process.execPath,
    args: ["scripts/build-packages.js"],
    cwd: repositoryRoot,
  },
  ...(!skipInstall
    ? [
        {
          name: "Core dependencies",
          command: npmCommand,
          args: ["ci", "--no-audit", "--no-fund"],
          cwd: path.join(repositoryRoot, "core"),
        },
      ]
    : []),
  {
    name: "Core install-script policy",
    command: npmCommand,
    args: ["run", "check:install-scripts"],
    cwd: path.join(repositoryRoot, "core"),
  },
  {
    name: "Core dependency policy",
    command: npmCommand,
    args: ["run", "check:dependency-policy"],
    cwd: path.join(repositoryRoot, "core"),
  },
  {
    name: "Core audit",
    command: npmCommand,
    args: ["audit", "--audit-level=high"],
    cwd: path.join(repositoryRoot, "core"),
  },
  {
    name: "Core build",
    command: npmCommand,
    args: ["run", "build"],
    cwd: path.join(repositoryRoot, "core"),
  },
  {
    name: "Core typecheck",
    command: npmCommand,
    args: ["run", "tsc:check"],
    cwd: path.join(repositoryRoot, "core"),
  },
  {
    name: "Core lint",
    command: npmCommand,
    args: ["run", "lint", "--", "--quiet"],
    cwd: path.join(repositoryRoot, "core"),
  },
  ...(!skipInstall
    ? [
        {
          name: "CLI dependencies",
          command: npmCommand,
          args: ["ci", "--include=optional", "--no-audit", "--no-fund"],
          cwd: path.join(repositoryRoot, "extensions/cli"),
        },
      ]
    : []),
  {
    name: "CLI install-script policy",
    command: npmCommand,
    args: ["run", "check:install-scripts"],
    cwd: path.join(repositoryRoot, "extensions/cli"),
  },
  {
    name: "CLI dependency policy",
    command: npmCommand,
    args: ["run", "check:dependency-policy"],
    cwd: path.join(repositoryRoot, "extensions/cli"),
  },
  {
    name: "CLI audit",
    command: npmCommand,
    args: ["audit", "--audit-level=high"],
    cwd: path.join(repositoryRoot, "extensions/cli"),
  },
  {
    name: "CLI typecheck",
    command: npmCommand,
    args: ["run", "typecheck"],
    cwd: path.join(repositoryRoot, "extensions/cli"),
  },
  {
    name: "CLI build",
    command: npmCommand,
    args: ["run", "build"],
    cwd: path.join(repositoryRoot, "extensions/cli"),
  },
  {
    name: "CLI smoke tests",
    command: npmCommand,
    args: ["run", "test:smoke"],
    cwd: path.join(repositoryRoot, "extensions/cli"),
  },
  {
    name: "CLI-Core runtime boundary",
    command: npmCommand,
    args: ["run", "test:runtime-boundary"],
    cwd: path.join(repositoryRoot, "extensions/cli"),
  },
  {
    name: "CLI release artifact",
    command: npmCommand,
    args: ["run", "check:release-artifact"],
    cwd: path.join(repositoryRoot, "extensions/cli"),
  },
  {
    name: "Rust format",
    command: "cargo",
    args: ["fmt", "--check"],
    cwd: path.join(repositoryRoot, "sync"),
  },
  {
    name: "Rust locked check",
    command: "cargo",
    args: ["check", "--locked"],
    cwd: path.join(repositoryRoot, "sync"),
  },
  {
    name: "Rust tests",
    command: "cargo",
    args: ["test", "--locked"],
    cwd: path.join(repositoryRoot, "sync"),
  },
  {
    name: "Rust ignored benchmark",
    command: "cargo",
    args: ["test", "--locked", "benchmark_load_vectors", "--", "--ignored"],
    cwd: path.join(repositoryRoot, "sync"),
  },
  {
    name: "Rust audit",
    command: "cargo",
    args: ["audit"],
    cwd: path.join(repositoryRoot, "sync"),
  },
];

function runCommand(step) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    console.log(`\n[retained-closure] ${step.name}`);
    console.log(`[retained-closure] $ ${step.command} ${step.args.join(" ")}`);
    const child = spawn(step.command, step.args, {
      cwd: step.cwd,
      env: { ...process.env, CI: "true" },
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("close", (code, signal) => {
      const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (code === 0) {
        console.log(
          `[retained-closure] PASS ${step.name} (${elapsedSeconds}s)`,
        );
        resolve();
        return;
      }
      reject(
        new Error(
          `${step.name} failed with ${signal ?? `exit code ${code}`} after ${elapsedSeconds}s`,
        ),
      );
    });
  });
}

try {
  for (const step of commands) {
    await runCommand(step);
  }
  console.log("\n[retained-closure] All checks passed.");
} catch (error) {
  console.error(`\n[retained-closure] FAILED: ${error.message}`);
  process.exitCode = 1;
}
