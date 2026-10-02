#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const configurationPath = path.join(scriptDirectory, "rust-tooling.json");
const configuration = JSON.parse(fs.readFileSync(configurationPath, "utf8"));
const cargoBin = process.env.HOME
  ? path.join(process.env.HOME, ".cargo", "bin")
  : null;
const environment = {
  ...process.env,
  PATH: [cargoBin, process.env.PATH].filter(Boolean).join(path.delimiter),
};
const workingDirectory = path.join(repositoryRoot, "sync");

const checks = [
  ["rustc", ["--version"], configuration.rustc],
  ["cargo", ["--version"], configuration.cargo],
  ["rustfmt", ["--version"], configuration.rustfmt],
  ["cargo", ["audit", "--version"], configuration.cargo_audit],
];

const results = [];
let passed = true;

for (const [command, args, expected] of checks) {
  const result = spawnSync(command, args, {
    cwd: workingDirectory,
    encoding: "utf8",
    env: environment,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const version = output.match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null;
  const checkPassed = result.status === 0 && version === expected;
  passed &&= checkPassed;
  results.push({
    command: [command, ...args].join(" "),
    expected,
    actual: version,
    passed: checkPassed,
    output,
  });
}

console.log(
  JSON.stringify(
    {
      check: "opencircuit-rust-toolchain",
      status: passed ? "pass" : "fail",
      results,
    },
    null,
    2,
  ),
);

if (!passed) {
  process.exitCode = 1;
}
