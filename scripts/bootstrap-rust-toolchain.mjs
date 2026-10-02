#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const configuration = JSON.parse(
  fs.readFileSync(path.join(scriptDirectory, "rust-tooling.json"), "utf8"),
);
const cargoBin = path.join(process.env.HOME ?? os.homedir(), ".cargo", "bin");
const environment = {
  ...process.env,
  PATH: [cargoBin, process.env.PATH].filter(Boolean).join(path.delimiter),
};
const checkScript = path.join(scriptDirectory, "check-rust-toolchain.mjs");
const rustupInstallUrl = "https://sh.rustup.rs";

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: environment,
    stdio: options.capture === false ? "inherit" : "pipe",
  });
}

function toolchainCheck() {
  return run(process.execPath, [checkScript]);
}

function fail(blocker, actionTaken) {
  console.log(
    JSON.stringify(
      {
        check: "opencircuit-rust-bootstrap",
        status: "failed",
        action_taken: actionTaken,
        blocker,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}

const targetPlatform =
  process.env.OC_RUST_BOOTSTRAP_PLATFORM_OVERRIDE ?? process.platform;

if (targetPlatform !== "linux") {
  fail(
    `Server1 Rust bootstrap only supports Linux, not ${targetPlatform}`,
    "none",
  );
} else {
  const before = toolchainCheck();
  if (before.status === 0) {
    console.log(
      JSON.stringify(
        {
          check: "opencircuit-rust-bootstrap",
          status: "pass",
          action_taken: "none",
          versions: JSON.parse(before.stdout).results,
        },
        null,
        2,
      ),
    );
  } else {
    let actionTaken = "rust_toolchain_install";
    let rustup = run("rustup", ["--version"]);

    if (rustup.status !== 0) {
      if (run("curl", ["--version"]).status !== 0) {
        fail("curl is required to install user-local rustup", "none");
      } else {
        const installer = run(
          "curl",
          [
            "--proto",
            "=https",
            "--tlsv1.2",
            "--fail",
            "--silent",
            "--show-error",
            rustupInstallUrl,
          ],
          { capture: true },
        );
        if (installer.status !== 0 || !installer.stdout) {
          fail("official rustup installer download failed", "none");
        } else {
          const install = spawnSync(
            "sh",
            ["-s", "--", "-y", "--profile", "minimal"],
            {
              cwd: repositoryRoot,
              encoding: "utf8",
              env: environment,
              input: installer.stdout,
              stdio: ["pipe", "inherit", "inherit"],
            },
          );
          if (install.status !== 0) {
            fail("user-local rustup installation failed", "rustup_install");
          }
          rustup = run("rustup", ["--version"]);
        }
      }
    }

    if (process.exitCode === undefined && rustup.status === 0) {
      const toolchain = run(
        "rustup",
        [
          "toolchain",
          "install",
          configuration.rustc,
          "--profile",
          "minimal",
          "--component",
          "rustfmt",
        ],
        { capture: false },
      );
      const defaultToolchain =
        toolchain.status === 0
          ? run("rustup", ["default", configuration.rustc], { capture: false })
          : toolchain;
      const audit =
        defaultToolchain.status === 0
          ? run(
              "cargo",
              [
                "install",
                "cargo-audit",
                "--version",
                configuration.cargo_audit,
                "--locked",
              ],
              { capture: false },
            )
          : defaultToolchain;

      if (audit.status !== 0) {
        fail("pinned cargo-audit installation failed", actionTaken);
      } else {
        const after = toolchainCheck();
        if (after.status !== 0) {
          fail(
            "Rust bootstrap completed but the pinned toolchain preflight failed",
            actionTaken,
          );
        } else {
          console.log(
            JSON.stringify(
              {
                check: "opencircuit-rust-bootstrap",
                status: "pass",
                action_taken: actionTaken,
                versions: JSON.parse(after.stdout).results,
              },
              null,
              2,
            ),
          );
        }
      }
    }
  }
}
