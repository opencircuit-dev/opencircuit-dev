// Resolves the packages esbuild actually bundled into the CLI (from
// extensions/cli/dist/meta.json) and ties each third-party package to the
// lockfile entry that installed it. Shared by notice and SBOM generation so
// both describe the same closure.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const cliRoot = resolve(repositoryRoot, "extensions/cli");

// Directories whose package-lock.json installs node_modules that the CLI
// bundle may draw from.
const lockfileDirectories = [
  cliRoot,
  resolve(repositoryRoot, "core"),
  repositoryRoot,
];

export const bundleLockfiles = lockfileDirectories.map((directory) =>
  relative(repositoryRoot, resolve(directory, "package-lock.json")),
);

export function collectBundledPackages() {
  const metadataPath = resolve(cliRoot, "dist/meta.json");
  if (!existsSync(metadataPath)) {
    throw new Error(
      "extensions/cli/dist/meta.json is required; build the CLI first",
    );
  }
  const metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  const lockfiles = new Map();
  const thirdParty = new Map();
  const firstParty = new Map();
  const seenRoots = new Set();
  const errors = [];

  for (const input of Object.keys(metadata.inputs ?? {})) {
    const inputPath = resolve(cliRoot, input);
    const packageRoot = thirdPartyPackageRoot(inputPath);
    if (!packageRoot) {
      const root = firstPartyPackageRoot(inputPath);
      if (!root) {
        errors.push(`no owning package.json for bundled input: ${input}`);
      } else if (!firstParty.has(root.name)) {
        firstParty.set(root.name, root);
      }
      continue;
    }
    const key = relative(repositoryRoot, packageRoot);
    if (seenRoots.has(key)) continue;
    seenRoots.add(key);
    let entry;
    try {
      entry = describeThirdParty(packageRoot, lockfiles);
    } catch (error) {
      errors.push(`${key}: ${error.message}`);
      continue;
    }
    const id = `${entry.name}@${entry.version}`;
    const existing = thirdParty.get(id);
    if (existing) {
      existing.paths.add(key);
    } else {
      thirdParty.set(id, { ...entry, paths: new Set([key]) });
    }
  }

  const allowedLicenses = readLicenseAllowlist();
  for (const entry of thirdParty.values()) {
    if (entry.license === "UNKNOWN") {
      errors.push(
        `${entry.name}@${entry.version}: license is not declared in package.json`,
      );
    } else if (!isLicenseAllowed(entry.license, allowedLicenses)) {
      errors.push(
        `${entry.name}@${entry.version}: license ${entry.license} is not in scripts/license-allowlist.json`,
      );
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `bundled package closure is incomplete:\n  ${errors.join("\n  ")}`,
    );
  }

  const byId = (left, right) =>
    `${left.name}@${left.version}`.localeCompare(
      `${right.name}@${right.version}`,
    );
  return {
    thirdParty: [...thirdParty.values()]
      .map((entry) => ({ ...entry, paths: [...entry.paths].sort() }))
      .sort(byId),
    firstParty: [...firstParty.values()].sort(byId),
  };
}

export function findNoticeFiles(packageRoot) {
  return readdirSync(packageRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && /^(?:licen[cs]e|copying|notice)/i.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}

export function formatLicense(license) {
  if (typeof license === "string" && license.trim()) return license.trim();
  if (Array.isArray(license) && license.length > 0) {
    return license
      .map((entry) =>
        typeof entry === "string" ? entry : (entry?.type ?? "UNKNOWN"),
      )
      .join(" OR ");
  }
  if (license && typeof license === "object" && license.type) {
    return license.type;
  }
  return "UNKNOWN";
}

export function readLicenseAllowlist() {
  const manifest = JSON.parse(
    readFileSync(
      resolve(repositoryRoot, "scripts/license-allowlist.json"),
      "utf8",
    ),
  );
  if (
    manifest.schemaVersion !== "open-circuit.license-allowlist.v1" ||
    !Array.isArray(manifest.allowed)
  ) {
    throw new Error("unsupported license allowlist schema");
  }
  return new Set(manifest.allowed);
}

// Evaluates an SPDX expression: OR passes when any branch is allowed, AND and
// WITH pass only when every part is. Anything unparseable is rejected.
export function isLicenseAllowed(expression, allowed) {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  let position = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];

  function parseOr() {
    let result = parseAnd();
    while (peek() === "OR") {
      next();
      const right = parseAnd();
      result = result || right;
    }
    return result;
  }
  function parseAnd() {
    let result = parseWith();
    while (peek() === "AND") {
      next();
      const right = parseWith();
      result = result && right;
    }
    return result;
  }
  function parseWith() {
    let result = parseTerm();
    while (peek() === "WITH") {
      next();
      const exception = next();
      result = result && allowed.has(`WITH ${exception}`);
    }
    return result;
  }
  function parseTerm() {
    const token = next();
    if (token === "(") {
      const result = parseOr();
      if (next() !== ")") throw new Error("unbalanced SPDX expression");
      return result;
    }
    if (!token || ["AND", "OR", "WITH", ")"].includes(token)) {
      throw new Error("malformed SPDX expression");
    }
    return allowed.has(token);
  }

  try {
    const result = parseOr();
    return position === tokens.length && result;
  } catch {
    return false;
  }
}

// The package root is the path through the last node_modules/<name> (or
// node_modules/@scope/<name>) segment. Nested package.json stubs such as
// dist/esm/package.json are ignored by construction.
function thirdPartyPackageRoot(inputPath) {
  const parts = inputPath.split(sep);
  const index = parts.lastIndexOf("node_modules");
  if (index === -1 || index + 1 >= parts.length) return undefined;
  const length = parts[index + 1].startsWith("@") ? 3 : 2;
  return parts.slice(0, index + length).join(sep);
}

function firstPartyPackageRoot(inputPath) {
  let directory = dirname(inputPath);
  while (directory.startsWith(repositoryRoot)) {
    const packagePath = resolve(directory, "package.json");
    if (existsSync(packagePath)) {
      const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
      if (typeof packageJson.name === "string" && packageJson.name) {
        return {
          name: packageJson.name,
          version:
            typeof packageJson.version === "string"
              ? packageJson.version
              : null,
          license: formatLicense(packageJson.license ?? packageJson.licenses),
          path: relative(repositoryRoot, directory),
        };
      }
    }
    if (directory === repositoryRoot) break;
    directory = dirname(directory);
  }
  return undefined;
}

function describeThirdParty(packageRoot, lockfiles) {
  const packageJson = JSON.parse(
    readFileSync(resolve(packageRoot, "package.json"), "utf8"),
  );
  if (
    typeof packageJson.name !== "string" ||
    typeof packageJson.version !== "string"
  ) {
    throw new Error("package.json lacks a name or version");
  }
  const lockDirectory = lockfileDirectories.find((directory) =>
    relative(directory, packageRoot).startsWith(`node_modules${sep}`),
  );
  if (!lockDirectory) throw new Error("not installed by a known lockfile");
  const lockKey = relative(lockDirectory, packageRoot).split(sep).join("/");
  const lockEntry = readLockfile(lockDirectory, lockfiles).packages?.[lockKey];
  if (!lockEntry) {
    throw new Error(
      `missing from ${relative(repositoryRoot, lockDirectory) || "."}/package-lock.json`,
    );
  }
  if (lockEntry.version !== packageJson.version) {
    throw new Error(
      `installed ${packageJson.version} differs from locked ${lockEntry.version}`,
    );
  }
  return {
    name: packageJson.name,
    version: packageJson.version,
    license: formatLicense(packageJson.license ?? packageJson.licenses),
    root: packageRoot,
    lockfile: relative(
      repositoryRoot,
      resolve(lockDirectory, "package-lock.json"),
    ),
    resolved: lockEntry.resolved ?? null,
    integrity: lockEntry.integrity ?? null,
  };
}

function readLockfile(directory, cache) {
  if (!cache.has(directory)) {
    cache.set(
      directory,
      JSON.parse(readFileSync(resolve(directory, "package-lock.json"), "utf8")),
    );
  }
  return cache.get(directory);
}
