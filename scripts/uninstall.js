const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");
if (path.resolve(process.cwd()) !== repoRoot) {
  throw new Error(`Run this script from the repository root: ${repoRoot}`);
}

const directories = [
  // core
  "core/node_modules",
  "core/dist",
  // CLI
  "extensions/cli/node_modules",
  "extensions/cli/dist",
  // packages
  "packages/config-types/node_modules",
  "packages/config-types/dist",
  "packages/fetch/node_modules",
  "packages/fetch/dist",
  "packages/llm-info/node_modules",
  "packages/llm-info/dist",
  "packages/config-yaml/node_modules",
  "packages/config-yaml/dist",
  "packages/openai-adapters/node_modules",
  "packages/openai-adapters/dist",
  // root
  "node_modules",
];

directories.forEach((dir) => {
  const target = path.join(repoRoot, dir);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`Removed ${target}`);
  } else {
    console.log(`${target} not found`);
  }
});
