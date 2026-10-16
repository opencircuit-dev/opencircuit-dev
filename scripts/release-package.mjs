#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ConventionalChangelog } from "conventional-changelog";
import { Bumper } from "conventional-recommended-bump";
import semver from "semver";

const packageNames = new Set([
  "cli",
  "config-yaml",
  "fetch",
  "llm-info",
  "openai-adapters",
  "sdk",
]);

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args[0]} failed (exit ${result.status}).`);
  }
  return result.stdout?.trim() ?? "";
}

export function recommendRelease(commits, packageName) {
  let level = 3;
  for (const commit of commits) {
    let candidate = 3;
    const breaking = (commit.notes?.length ?? 0) > 0;
    if (packageName === "cli") {
      if (["feat", "fix", "perf", "revert"].includes(commit.type)) {
        candidate = 2;
      } else if (
        !["docs", "style", "chore", "refactor", "test", "build", "ci"].includes(
          commit.type,
        ) &&
        breaking
      ) {
        candidate = 0;
      }
    } else if (commit.scope === `packages/${packageName}` && breaking) {
      candidate = 0;
    } else if (
      commit.scope === "packages/config-yaml" &&
      commit.type === "feat"
    ) {
      candidate = 1;
    } else if (commit.scope === `packages/${packageName}`) {
      candidate = 2;
    } else if (breaking) {
      candidate = 0;
    } else if (commit.type === "feat") {
      candidate = 1;
    } else if (["fix", "perf", "revert"].includes(commit.type)) {
      candidate = 2;
    }
    level = Math.min(level, candidate);
  }
  return level < 3 ? { level } : {};
}

export async function planRelease(cwd = process.cwd()) {
  const manifest = JSON.parse(fs.readFileSync(path.join(cwd, "package.json")));
  const packageName = manifest.name?.replace(/^@opencircuit\//, "");
  if (
    !packageNames.has(packageName) ||
    manifest.name !== `@opencircuit/${packageName}`
  ) {
    throw new Error("Release must run from a retained Open Circuit package.");
  }
  const root = run("git", ["rev-parse", "--show-toplevel"], cwd);
  const prefix = packageName === "cli" ? "v" : `${manifest.name}@`;
  const tags = run(
    "git",
    ["tag", "--merged", "HEAD", "--list", `${prefix}*`],
    cwd,
  )
    .split("\n")
    .filter(
      (tag) => tag.startsWith(prefix) && semver.valid(tag.slice(prefix.length)),
    )
    .sort((left, right) =>
      semver.rcompare(left.slice(prefix.length), right.slice(prefix.length)),
    );
  const previousTag = tags[0] ?? "";
  const recommendation = await new Bumper(root)
    .loadPreset("conventionalcommits")
    .tag(previousTag)
    .bump((commits) => recommendRelease(commits, packageName));
  if (!recommendation.releaseType) return null;
  const version = previousTag
    ? semver.inc(previousTag.slice(prefix.length), recommendation.releaseType)
    : semver.valid(manifest.version);
  if (!version) throw new Error("Release version must be valid semver.");
  const tag = `${prefix}${version}`;
  const generator = new ConventionalChangelog(root)
    .readPackage(path.join(cwd, "package.json"))
    .readRepository()
    .loadPreset("conventionalcommits")
    .tags({ prefix })
    .commits({ from: previousTag })
    .context({ version, currentTag: tag, previousTag });
  let notes = "";
  for await (const chunk of generator.write()) notes += chunk;
  return { name: manifest.name, version, tag, previousTag, notes };
}

export async function releasePackage(
  args = process.argv.slice(2),
  cwd = process.cwd(),
) {
  if (
    args.some((arg) => !["--execute", "--dry-run"].includes(arg)) ||
    args.length > 1
  ) {
    throw new Error("Use --dry-run (default) or --execute.");
  }
  const execute = args.includes("--execute");
  if (execute) {
    if (
      process.env.GITHUB_ACTIONS !== "true" ||
      process.env.GITHUB_REF !== "refs/heads/main"
    ) {
      throw new Error("Publishing requires GitHub Actions on main.");
    }
    if (
      run("git", ["branch", "--show-current"], cwd) !== "main" ||
      run("git", ["status", "--porcelain"], cwd)
    ) {
      throw new Error("Publishing requires a clean main checkout.");
    }
    if (
      !process.env.GITHUB_TOKEN ||
      !(process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN)
    ) {
      throw new Error("Publishing requires GitHub and npm credentials.");
    }
  }
  const plan = await planRelease(cwd);
  console.log(JSON.stringify({ dryRun: !execute, release: plan }, null, 2));
  if (!execute || !plan) return plan;
  const server = new URL(process.env.GITHUB_SERVER_URL ?? "https://github.com");
  const repository = process.env.GITHUB_REPOSITORY;
  if (
    server.username ||
    server.password ||
    server.origin !== "https://github.com" ||
    repository !== "opencircuit-dev/opencircuit-dev"
  ) {
    throw new Error("Unexpected release repository.");
  }
  const origin = run("git", ["remote", "get-url", "origin"], cwd);
  if (origin.replace(/\.git$/, "") !== `${server.origin}/${repository}`) {
    throw new Error("Release origin must match the workflow repository.");
  }
  if (
    run("git", ["ls-remote", "--tags", "origin", `refs/tags/${plan.tag}`], cwd)
  ) {
    throw new Error("Release tag already exists on origin.");
  }
  const githubEnvironment = {
    ...process.env,
    GH_HOST: server.hostname,
    GH_TOKEN: process.env.GITHUB_TOKEN,
  };
  run("gh", ["auth", "status", "--hostname", server.hostname], cwd, {
    env: githubEnvironment,
  });
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  run(
    npmCommand,
    [
      "version",
      plan.version,
      "--no-git-tag-version",
      "--allow-same-version",
      "--ignore-scripts",
    ],
    cwd,
  );
  const changelogPath = path.join(cwd, "CHANGELOG.md");
  const previousNotes = fs.existsSync(changelogPath)
    ? fs.readFileSync(changelogPath, "utf8")
    : "";
  fs.writeFileSync(changelogPath, `${plan.notes}\n${previousNotes}`);
  run(npmCommand, ["run", "build"], cwd, { stdio: "inherit" });
  run(npmCommand, ["publish", "--access", "public", "--ignore-scripts"], cwd, {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_AUTH_TOKEN: process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN,
    },
  });
  run("git", ["tag", plan.tag], cwd);
  run("git", ["push", "origin", `refs/tags/${plan.tag}`], cwd);
  run(
    "gh",
    [
      "release",
      "create",
      plan.tag,
      "--repo",
      `${server.hostname}/${repository}`,
      "--verify-tag",
      "--title",
      plan.tag,
      "--notes-file",
      "-",
    ],
    cwd,
    {
      input: plan.notes,
      env: githubEnvironment,
    },
  );
  return plan;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await releasePackage();
}
