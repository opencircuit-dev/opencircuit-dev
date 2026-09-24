const { execFileSync } = require("child_process");

const PLATFORMS = [
  "win32-x64",
  //   "win32-arm64", can't be built due to no sqlite3 binaries
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
];
const args = process.argv.slice(2);
const isPreRelease = args.includes("--pre-release");

void (async () => {
  for (const i in PLATFORMS) {
    const platform = PLATFORMS[i];
    execFileSync(
      "node",
      ["scripts/prepackage-cross-platform.js", "--target", platform],
      {
        stdio: "inherit",
      },
    );
    execFileSync(
      "node",
      [
        "scripts/package.js",
        ...(isPreRelease ? ["--pre-release"] : []),
        "--target",
        platform,
      ],
      { stdio: "inherit" },
    );
  }
  process.exit(0);
})();
