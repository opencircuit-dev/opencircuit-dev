const { spawn } = require("child_process");
const fs = require("fs");

const version = JSON.parse(
  fs.readFileSync("./package.json", { encoding: "utf-8" }),
).version;

const args = process.argv.slice(2);
let target;

if (args[0] === "--target") {
  target = args[1];
}

if (!fs.existsSync("build")) {
  fs.mkdirSync("build");
}

const isPreRelease = args.includes("--pre-release");

if (target && !/^(win32|linux|darwin|alpine)-(x64|arm64|armhf)$/.test(target)) {
  throw new Error(`Unsupported VS Code target: ${target}`);
}

const commandArgs = [
  "@vscode/vsce",
  "package",
  "--out",
  "./build",
  "--no-dependencies",
  ...(isPreRelease ? ["--pre-release"] : []),
  ...(target ? ["--target", target] : []),
];

const child = spawn("npx", commandArgs, { stdio: "inherit" });
child.on("close", (code) => {
  if (code !== 0) {
    process.exitCode = code ?? 1;
    return;
  }
  console.log(
    `vsce package completed - extension created at extensions/vscode/build/ocircuit-${version}.vsix`,
  );
});
