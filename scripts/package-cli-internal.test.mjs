import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateReleaseProfile } from "./cisco-release-profile.mjs";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const packager = path.join(scriptsDirectory, "package-cli-internal.mjs");
const { version } = JSON.parse(
  fs.readFileSync(
    path.join(scriptsDirectory, "../extensions/cli/package.json"),
    "utf8",
  ),
);
const artifact = `opencircuit-cli-internal-${version}.tgz`;
const realNpm = execFileSync("which", ["npm"], { encoding: "utf8" }).trim();
const syntheticProfile = [
  "OCIRCUIT_CISCO_ISSUER=https://login.microsoftonline.com/00000000-0000-4000-8000-000000000000/v2.0",
  "OCIRCUIT_CISCO_CLIENT_ID=11111111-1111-4111-8111-111111111111",
  "OCIRCUIT_CISCO_SCOPES=openid offline_access",
  "OCIRCUIT_CISCO_GATEWAY_BASE=https://organon.cisco.com/vscode-plugin",
  "OCIRCUIT_CISCO_MODEL_API_VERSION=2024-07-01-preview",
].join("\n");

// Wraps the installed npm and rewrites `npm pack --json` output into the
// requested shape: "keyed" (npm 12) or "array" (npm 10/11).
const npmShim = `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const json = args[0] === "pack" && args.includes("--json");
const result = spawnSync(process.env.OC_TEST_REAL_NPM, args, {
  stdio: json ? ["inherit", "pipe", "inherit"] : "inherit",
  encoding: "utf8",
});
if (json && result.status === 0) {
  const parsed = JSON.parse(result.stdout);
  const reports = Array.isArray(parsed) ? parsed : Object.values(parsed);
  const output = process.env.OC_TEST_NPM_FORMAT === "keyed"
    ? Object.fromEntries(reports.map((report) => [report.name, report]))
    : reports;
  process.stdout.write(JSON.stringify(output));
}
process.exit(result.status ?? 1);
`;

function runPackager(format, { args = [], profile } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "oc-pack-test-"));
  const binDirectory = path.join(directory, "bin");
  const outputDirectory = path.join(directory, "out");
  fs.mkdirSync(binDirectory);
  fs.writeFileSync(path.join(binDirectory, "npm"), npmShim, { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: `${binDirectory}${path.delimiter}${process.env.PATH}`,
    OC_TEST_REAL_NPM: realNpm,
    OC_TEST_NPM_FORMAT: format,
    OCIRCUIT_RELEASE_PROFILE_ID: "test-profile",
  };
  delete env.OCIRCUIT_RELEASE_CISCO_PROFILE;
  delete env.OCIRCUIT_RELEASE_CISCO_PROFILE_FILE;
  if (profile) env.OCIRCUIT_RELEASE_CISCO_PROFILE = profile;
  execFileSync(
    process.execPath,
    [packager, "--output-dir", outputDirectory, ...args],
    { env, stdio: ["ignore", "ignore", "pipe"] },
  );
  const tarball = path.join(outputDirectory, artifact);
  return {
    directory,
    outputDirectory,
    tarball,
    files: execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean),
    provenance: JSON.parse(
      fs.readFileSync(`${tarball}.provenance.json`, "utf8"),
    ),
  };
}

function cleanup(result) {
  fs.rmSync(result.directory, { recursive: true, force: true });
}

test("packages without a profile using npm 12 keyed pack reports", () => {
  const result = runPackager("keyed", { args: ["--no-profile"] });
  try {
    assert.ok(result.files.includes("package/package.json"));
    assert.ok(
      !result.files.some((file) => file.startsWith("package/profiles/")),
    );
    assert.equal(result.provenance.protectedProfileIncluded, false);
    assert.equal(result.provenance.protectedProfile, null);
    assert.equal(result.provenance.protectedProfileSha256, null);
  } finally {
    cleanup(result);
  }
});

for (const format of ["keyed", "array"]) {
  test(`injects a validated profile using ${format} pack reports`, () => {
    const result = runPackager(format, { profile: syntheticProfile });
    try {
      const expected = validateReleaseProfile(syntheticProfile);
      const packed = execFileSync(
        "tar",
        ["-xzOf", result.tarball, "package/profiles/cisco-circuit.env"],
        { encoding: "utf8" },
      );
      assert.equal(packed, expected);
      assert.equal(result.provenance.protectedProfileIncluded, true);
      assert.equal(result.provenance.protectedProfile, "test-profile");
      assert.equal(
        result.provenance.protectedProfileSha256,
        createHash("sha256").update(expected).digest("hex"),
      );
      assert.deepEqual(fs.readdirSync(result.outputDirectory).sort(), [
        artifact,
        `${artifact}.provenance.json`,
        `${artifact}.sha256`,
      ]);
    } finally {
      cleanup(result);
    }
  });
}
