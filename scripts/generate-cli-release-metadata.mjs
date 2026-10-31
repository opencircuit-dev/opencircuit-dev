#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import {
  bundleLockfiles,
  cliRoot,
  collectBundledPackages,
  repositoryRoot,
} from "./cli-bundle-closure.mjs";

const argumentsList = process.argv.slice(2);
const artifact = resolve(requiredOption("--artifact"));
const outputDirectory = resolve(option("--output-dir") ?? dirname(artifact));
const packageJson = JSON.parse(
  readFileSync(resolve(cliRoot, "package.json"), "utf8"),
);
const lockfile = resolve(cliRoot, "package-lock.json");
const artifactName = basename(artifact);
const stem = artifactName.replace(/\.tgz$/, "");

if (!/^opencircuit-cli-\d+\.\d+\.\d+\.tgz$/.test(artifactName)) {
  throw new Error(`unexpected CLI artifact name: ${artifactName}`);
}

const artifactSha256 = sha256(artifact);
const lockfileSha256 = sha256(lockfile);
const { thirdParty, firstParty } = collectBundledPackages();
const noticesSource = readFileSync(
  resolve(cliRoot, "THIRD_PARTY_NOTICES.txt"),
  "utf8",
);
const noticeLines = noticesSource.split("\n");
const listedInNotices = new Set(
  noticeLines.filter(
    (line, index) =>
      /^\S+@\S+$/.test(line) && noticeLines[index + 1]?.startsWith("License: "),
  ),
);
const missingNotices = thirdParty
  .map((entry) => `${entry.name}@${entry.version}`)
  .filter((id) => !listedInNotices.delete(id));
if (missingNotices.length > 0 || listedInNotices.size > 0) {
  throw new Error(
    "THIRD_PARTY_NOTICES.txt does not match the bundled closure; run npm run generate:notices in extensions/cli" +
      (missingNotices.length
        ? `\n  missing: ${missingNotices.join(", ")}`
        : "") +
      (listedInNotices.size
        ? `\n  extra: ${[...listedInNotices].join(", ")}`
        : ""),
  );
}

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    component: component("application", {
      name: packageJson.name,
      version: packageJson.version,
      license: packageJson.license,
    }),
    properties: [
      {
        name: "opencircuit:closure-source",
        value: "extensions/cli/dist/meta.json",
      },
    ],
  },
  components: [
    ...firstParty
      .filter((entry) => entry.name !== packageJson.name)
      .map((entry) =>
        component("library", entry, [
          { name: "opencircuit:first-party", value: "true" },
          { name: "opencircuit:source-path", value: entry.path },
        ]),
      ),
    ...thirdParty.map((entry) =>
      component(
        "library",
        entry,
        [
          { name: "opencircuit:lockfile", value: entry.lockfile },
          ...entry.paths.map((path) => ({
            name: "opencircuit:bundle-path",
            value: path,
          })),
        ],
        entry,
      ),
    ),
  ],
};
const sbomPath = resolve(outputDirectory, `${stem}.sbom.cdx.json`);
writeFileSync(sbomPath, `${JSON.stringify(sbom, null, 2)}\n`);

const notices = [
  readFileSync(resolve(cliRoot, "NOTICE.txt"), "utf8").trim(),
  noticesSource.trim(),
].join("\n\n");
const noticesPath = resolve(outputDirectory, `${stem}.NOTICES.txt`);
writeFileSync(noticesPath, `${notices}\n`);

const provenance = {
  schemaVersion: "open-circuit.provenance.v1",
  product: "Open Circuit",
  artifact: {
    name: artifactName,
    version: packageJson.version,
    sha256: artifactSha256,
    sizeBytes: readFileSync(artifact).byteLength,
  },
  source: {
    repository: "https://github.com/opencircuit-dev/opencircuit-dev",
    commit: git("rev-parse", "HEAD"),
    tag:
      process.env.RELEASE_TAG ??
      (process.env.GITHUB_REF_TYPE === "tag"
        ? process.env.GITHUB_REF_NAME
        : null),
    dirty: git("status", "--porcelain") !== "",
  },
  build: {
    workflow: process.env.GITHUB_WORKFLOW ?? "local",
    runId: process.env.GITHUB_RUN_ID ?? null,
    builder: process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
    os: process.env.RUNNER_OS ?? process.platform,
    architecture: process.env.RUNNER_ARCH ?? process.arch,
    node: process.version,
    npm: execFileSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["--version"],
      {
        encoding: "utf8",
      },
    ).trim(),
    lockfileSha256,
    sourceDateEpoch: process.env.SOURCE_DATE_EPOCH ?? null,
  },
  materials: [
    ...bundleLockfiles.map((path) => ({
      type: "npm-lockfile",
      path,
      sha256: sha256(resolve(repositoryRoot, path)),
    })),
    {
      type: "esbuild-metafile",
      path: "extensions/cli/dist/meta.json",
      sha256: sha256(resolve(cliRoot, "dist/meta.json")),
    },
  ],
  verification: {
    sbom: `${stem}.sbom.cdx.json`,
    sbomSha256: sha256(sbomPath),
    notices: `${stem}.NOTICES.txt`,
    noticesSha256: sha256(noticesPath),
    signatureOrAttestation: null,
  },
};
const provenancePath = resolve(outputDirectory, `${stem}.provenance.json`);
writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);

console.log(`Release metadata: ${provenancePath}`);
console.log(`Release SBOM: ${sbomPath}`);
console.log(`Release notices: ${noticesPath}`);

function option(name) {
  const index = argumentsList.indexOf(name);
  return index === -1 ? undefined : argumentsList[index + 1];
}

function requiredOption(name) {
  const value = option(name);
  if (!value || value.startsWith("--"))
    throw new Error(`${name} requires a value`);
  return value;
}

function component(type, entry, properties = [], lock) {
  const purl = `pkg:npm/${entry.name.replace(/^@/, "%40")}@${entry.version}`;
  const scoped = entry.name.match(/^(@[^/]+)\/(.+)$/);
  return {
    type,
    "bom-ref": purl,
    ...(scoped ? { group: scoped[1], name: scoped[2] } : { name: entry.name }),
    ...(entry.version ? { version: entry.version, purl } : {}),
    ...(entry.license && entry.license !== "UNKNOWN"
      ? { licenses: [{ expression: entry.license }] }
      : {}),
    ...(lock?.integrity ? { hashes: [integrityHash(lock.integrity)] } : {}),
    ...(lock?.resolved
      ? {
          externalReferences: [{ type: "distribution", url: lock.resolved }],
        }
      : {}),
    ...(properties.length > 0 ? { properties } : {}),
  };
}

function integrityHash(integrity) {
  const [algorithm, digest] = integrity.split(" ")[0].split(/-(.*)/s);
  const names = {
    sha1: "SHA-1",
    sha256: "SHA-256",
    sha384: "SHA-384",
    sha512: "SHA-512",
  };
  if (!names[algorithm]) {
    throw new Error(`unsupported integrity algorithm: ${algorithm}`);
  }
  return {
    alg: names[algorithm],
    content: Buffer.from(digest, "base64").toString("hex"),
  };
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
}
