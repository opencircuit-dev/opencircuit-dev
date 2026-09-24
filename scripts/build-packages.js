const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

function runCommand(command, cwd, packageName) {
  return new Promise((resolve, reject) => {
    console.log(`Starting ${packageName}: ${command}`);

    const [cmd, ...args] = command;
    const child = spawn(cmd, args, {
      cwd,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        console.log(`✅ ${packageName}: ${command} completed successfully`);
        resolve({ packageName, command, stdout, stderr });
      } else {
        console.error(`❌ ${packageName}: ${command} failed with code ${code}`);
        console.error(`stderr: ${stderr}`);
        console.error(`stdout: ${stdout}`);
        reject(
          new Error(`${packageName} failed: ${command} (exit code ${code})`),
        );
      }
    });

    child.on("error", (error) => {
      console.error(`❌ ${packageName}: Failed to start ${command}:`, error);
      reject(error);
    });
  });
}

// Helper function to build a package. Dependencies are installed once from
// the repository root workspace before this script runs; this script must
// not run npm install/ci inside any package.
async function buildPackage(packageName) {
  const packagePath = path.join(__dirname, "..", "packages", packageName);

  if (!fs.existsSync(packagePath)) {
    throw new Error(`Package directory not found: ${packagePath}`);
  }

  return runCommand(
    ["npm", "run", "build"],
    packagePath,
    `${packageName} (build)`,
  );
}

async function buildPackagesInParallel(packages) {
  const buildPromises = packages.map((pkg) => buildPackage(pkg));
  return Promise.all(buildPromises);
}

async function main() {
  try {
    console.log("🚀 Starting package builds...\n");

    // Phase 1: Build foundation packages (no local dependencies)
    await buildPackagesInParallel(["config-types", "terminal-security"]);

    // Phase 2: Build packages that depend on config-types
    await buildPackagesInParallel(["fetch", "config-yaml", "llm-info"]);

    // Phase 3: Build packages that depend on other local packages
    await buildPackagesInParallel(["openai-adapters"]);

    console.log("🎉 All packages built successfully!");
  } catch (error) {
    console.error("💥 Build failed:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
