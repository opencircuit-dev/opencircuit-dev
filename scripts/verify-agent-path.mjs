import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

const trustedCallerRepository = "opencircuit-dev/opencircuit-dev";
const approvedAgentPaths = new Map([
  [
    ".ocircuit/agents/breaking-change-detector.md",
    "1680061aced7e4a45514e7a56366f2fa12acfed0f807f088aaf409ee96a9c0ac",
  ],
  [
    ".ocircuit/agents/dependency-security-review.md",
    "f0b565b49fce27162ac6c48297710c25ec58438ce1986d15d358783e3d08d186",
  ],
  [
    ".ocircuit/agents/error-message-quality.md",
    "cb2cb2eeecd9a384c07aa3fdb22c03b8437205e9e8f3cfec37018eb5c2007af1",
  ],
  [
    ".ocircuit/agents/input-validation.md",
    "9f33469fe5ef3d0c0f3b9f5ad4a0bb0dfc6ac8d8db856c24d56620f86e7fb01f",
  ],
  [
    ".ocircuit/agents/test-coverage.md",
    "0d45be2381032b82f63b7f6a93f8e397a7a013fc29c90c4fbf7a501ed2220151",
  ],
]);

export function isAllowedAgentPath(agentPath) {
  return typeof agentPath === "string" && approvedAgentPaths.has(agentPath);
}

export function isTrustedAgentCaller(
  repository,
  eventName,
  ref,
  defaultBranch,
) {
  return (
    repository === trustedCallerRepository &&
    eventName === "push" &&
    typeof defaultBranch === "string" &&
    defaultBranch.length > 0 &&
    ref === `refs/heads/${defaultBranch}`
  );
}

function assertNotSymlink(filePath) {
  if (fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error("Agent path contains a symbolic link");
  }
}

export function validateAgentPath(agentPath, workingDirectory = process.cwd()) {
  if (!isAllowedAgentPath(agentPath)) {
    throw new Error("Agent path is outside the approved agent path format");
  }

  const realWorkingDirectory = fs.realpathSync(workingDirectory);
  const rootPath = path.join(realWorkingDirectory, ".ocircuit", "agents");
  assertNotSymlink(path.join(realWorkingDirectory, ".ocircuit"));
  assertNotSymlink(rootPath);

  const root = fs.realpathSync(rootPath);
  const candidate = path.resolve(realWorkingDirectory, agentPath);
  const relative = path.relative(root, candidate);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Agent path escapes the approved agent directory");
  }

  let currentPath = root;
  for (const part of relative.split(path.sep)) {
    currentPath = path.join(currentPath, part);
    assertNotSymlink(currentPath);
  }

  if (!fs.statSync(candidate).isFile()) {
    throw new Error("Agent path is not a regular file");
  }

  if (fs.realpathSync(candidate) !== candidate) {
    throw new Error("Agent path does not resolve to its approved location");
  }
  const hash = createHash("sha256")
    .update(fs.readFileSync(candidate))
    .digest("hex");
  if (hash !== approvedAgentPaths.get(agentPath)) {
    throw new Error("Agent content differs from the reviewed SHA-256 manifest");
  }

  return candidate;
}

export function discoverAgents(workingDirectory = process.cwd()) {
  const rootPath = path.join(workingDirectory, ".ocircuit", "agents");
  if (!fs.existsSync(rootPath)) {
    return [];
  }
  assertNotSymlink(path.join(workingDirectory, ".ocircuit"));
  assertNotSymlink(rootPath);

  const agents = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error("Agent discovery does not allow symbolic links");
      }
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const relativePath = path
          .relative(workingDirectory, fullPath)
          .split(path.sep)
          .join("/");
        validateAgentPath(relativePath, workingDirectory);
        agents.push(relativePath);
      }
    }
  };

  visit(rootPath);
  return agents.sort();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href
) {
  try {
    if (process.argv[2] === "--discover") {
      console.log(JSON.stringify(discoverAgents()));
    } else if (process.argv[2] === "--validate-caller") {
      if (
        !isTrustedAgentCaller(
          process.env.CALLER_REPOSITORY,
          process.env.CALLER_EVENT,
          process.env.CALLER_REF,
          process.env.DEFAULT_BRANCH,
        )
      ) {
        throw new Error(
          "Open Circuit Agents only runs for pushes to the repository default branch.",
        );
      }
    } else {
      validateAgentPath(process.argv[2]);
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Invalid agent path",
    );
    process.exitCode = 1;
  }
}
