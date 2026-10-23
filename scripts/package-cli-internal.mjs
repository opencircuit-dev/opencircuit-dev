#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  PACKAGED_PROFILE_PATH,
  readReleaseProfileSource,
  secureDelete,
  validateReleaseProfile,
} from "./cisco-release-profile.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliDirectory = resolve(repositoryRoot, "extensions/cli");
const packageJson = JSON.parse(
  readFileSync(resolve(cliDirectory, "package.json"), "utf8"),
);

function parseArguments() {
  const usage =
    "Usage: package-cli-internal.mjs [--output-dir <path>] [--no-profile]";
  const args = process.argv.slice(2);
  let outputDirectory = resolve(repositoryRoot, "../opencircuit-internal");
  let includeProfile = true;
  while (args.length > 0) {
    const arg = args.shift();
    if (arg === "--no-profile") {
      includeProfile = false;
    } else if (arg === "--output-dir" && args.length > 0) {
      outputDirectory = resolve(args.shift());
    } else {
      throw new Error(usage);
    }
  }
  return { outputDirectory, includeProfile };
}

const { outputDirectory, includeProfile } = parseArguments();
const version = packageJson.version;

if (packageJson.name !== "@opencircuit/cli") {
  throw new Error(`Unexpected CLI package: ${packageJson.name}`);
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(
    `Release version must be stable semver, received: ${version}`,
  );
}

const artifactName = `opencircuit-cli-internal-${version}.tgz`;
const artifactPath = resolve(outputDirectory, artifactName);
const checksumPath = `${artifactPath}.sha256`;
const provenancePath = `${artifactPath}.provenance.json`;

mkdirSync(outputDirectory, { recursive: true });
const stagingDirectory = mkdtempSync(
  join(outputDirectory, ".opencircuit-cli-internal-"),
);
const npmCacheDirectory = mkdtempSync(join(tmpdir(), "opencircuit-npm-cache-"));
// The protected profile is only ever written into this private copy of the
// package, never into the source tree.
const packageStage = mkdtempSync(join(tmpdir(), "opencircuit-cli-stage-"));
const stagedProfilePath = resolve(packageStage, PACKAGED_PROFILE_PATH);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npmEnv = { ...process.env, npm_config_cache: npmCacheDirectory };
for (const name of [
  "OCIRCUIT_RELEASE_CISCO_PROFILE",
  "OCIRCUIT_RELEASE_CISCO_PROFILE_FILE",
]) {
  delete npmEnv[name];
}

function packedFiles(cwd) {
  const [report] = JSON.parse(
    execFileSync(
      npmCommand,
      ["pack", "--dry-run", "--json", "--ignore-scripts"],
      {
        cwd,
        encoding: "utf8",
        env: npmEnv,
        maxBuffer: 16 * 1024 * 1024,
      },
    ),
  );
  return report.files.map((entry) => entry.path).sort();
}

try {
  let profileChecksum = null;
  let profileContent = null;
  if (includeProfile) {
    profileContent = validateReleaseProfile(readReleaseProfileSource());
    profileChecksum = createHash("sha256").update(profileContent).digest("hex");
  }

  for (const entry of [
    "package.json",
    ".npmignore",
    ...(packageJson.files ?? []),
  ]) {
    const source = resolve(cliDirectory, entry);
    if (entry === "profiles") {
      if (existsSync(source)) {
        throw new Error(
          "extensions/cli/profiles must not exist in the source tree",
        );
      }
      continue;
    }
    if (existsSync(source)) {
      cpSync(source, resolve(packageStage, entry), {
        recursive: true,
        verbatimSymlinks: true,
      });
    }
  }
  if (profileContent) {
    mkdirSync(dirname(stagedProfilePath), { mode: 0o700 });
    writeFileSync(stagedProfilePath, profileContent, {
      flag: "wx",
      mode: 0o600,
    });
  }

  const expectedFiles = packedFiles(cliDirectory);
  if (profileContent) expectedFiles.push(PACKAGED_PROFILE_PATH);
  expectedFiles.sort();
  const stagedFiles = packedFiles(packageStage);
  if (JSON.stringify(stagedFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error("Staged package contents differ from the CLI package");
  }

  execFileSync(
    npmCommand,
    ["pack", "--ignore-scripts", "--pack-destination", stagingDirectory],
    { cwd: packageStage, stdio: "inherit", env: npmEnv },
  );

  const packedArtifact = resolve(
    stagingDirectory,
    `opencircuit-cli-${version}.tgz`,
  );
  if (!existsSync(packedArtifact)) {
    throw new Error(
      `npm pack did not create the expected archive: ${packedArtifact}`,
    );
  }

  if (profileContent) {
    const packedProfile = execFileSync(
      "tar",
      ["-xzOf", packedArtifact, `package/${PACKAGED_PROFILE_PATH}`],
      { encoding: "utf8" },
    );
    if (packedProfile !== profileContent) {
      throw new Error(
        "Packed Cisco profile does not match the validated profile",
      );
    }
  }

  const checksum = createHash("sha256")
    .update(readFileSync(packedArtifact))
    .digest("hex");
  const stagedArtifact = resolve(stagingDirectory, artifactName);
  const stagedChecksum = `${stagedArtifact}.sha256`;
  renameSync(packedArtifact, stagedArtifact);
  writeFileSync(stagedChecksum, `${checksum}  ${basename(artifactName)}\n`);

  renameSync(stagedArtifact, artifactPath);
  renameSync(stagedChecksum, checksumPath);

  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  const sourceChanges = execFileSync("git", ["status", "--porcelain"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
  const profileIdentifier = includeProfile
    ? (process.env.OCIRCUIT_RELEASE_PROFILE_ID ?? "protected-runtime-profile")
    : null;
  if (profileIdentifier && !/^[A-Za-z0-9._:-]+$/.test(profileIdentifier)) {
    throw new Error(
      "OCIRCUIT_RELEASE_PROFILE_ID must be a non-secret identifier",
    );
  }
  writeFileSync(
    provenancePath,
    `${JSON.stringify(
      {
        artifact: artifactName,
        package: packageJson.name,
        version,
        sha256: checksum,
        sourceCommit,
        sourceTreeDirty: sourceChanges.length > 0,
        sourceChanges,
        protectedProfile: profileIdentifier,
        protectedProfileIncluded: includeProfile,
        protectedProfileSha256: profileChecksum,
        generatedWith: {
          node: process.version,
          npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
        },
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  console.log(`Internal release artifact: ${artifactPath}`);
  console.log(`SHA-256: ${checksum}`);
  console.log(`Provenance: ${provenancePath}`);
} finally {
  secureDelete(stagedProfilePath);
  rmSync(packageStage, { recursive: true, force: true });
  rmSync(stagingDirectory, { recursive: true, force: true });
  rmSync(npmCacheDirectory, { recursive: true, force: true });
}
