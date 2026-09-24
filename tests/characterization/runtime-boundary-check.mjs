#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  isSupportedNodeVersion,
  SUPPORTED_NODE_RANGE,
} from "./runtime-version.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../..");
const cliDirectory = path.join(repoRoot, "extensions/cli");
const loaderPath = path.join(scriptDirectory, "runtime-boundary-loader.mjs");
const pinnedNodeVersion = fs
  .readFileSync(path.join(repoRoot, ".node-version"), "utf8")
  .trim();
const runtimeSupported = isSupportedNodeVersion(
  process.version,
  pinnedNodeVersion,
);
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "ocircuit-runtime-boundary-"),
);
const loaderReportPath = path.join(temporaryDirectory, "runtime-loader.json");
const configPath = path.join(temporaryDirectory, "config.yaml");
const onboardingPath = path.join(
  temporaryDirectory,
  ".ocircuit",
  ".onboarding_complete",
);

const requests = [];
const server = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk.toString();
  });
  request.on("end", () => {
    requests.push({
      method: request.method,
      url: request.url,
      body: body ? JSON.parse(body) : null,
    });
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    response.write(
      'data: {"choices":[{"delta":{"content":"Hello World!"},"index":0}]}\n\n',
    );
    response.end("data: [DONE]\n\n");
  });
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("Unable to determine the mock server address.");
}

fs.mkdirSync(path.dirname(onboardingPath), { recursive: true });
fs.writeFileSync(onboardingPath, new Date(0).toISOString());
fs.writeFileSync(
  configPath,
  `name: Phase 0 Runtime Boundary
version: 1.0.0
schema: v1
models:
  - name: test-openai
    model: gpt-4
    provider: openai
    apiKey: test-key
    apiBase: http://127.0.0.1:${address.port}
    roles:
      - chat
`,
);

const childResult = await new Promise((resolve) => {
  const child = spawn(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-loader",
      loaderPath,
      "dist/oc.js",
      "-p",
      "--config",
      configPath,
      "Hi",
    ],
    {
      cwd: cliDirectory,
      env: {
        ...process.env,
        OCIRCUIT_CLI_TEST: "true",
        FORCE_NO_TTY: "true",
        HOME: temporaryDirectory,
        USERPROFILE: temporaryDirectory,
        PHASE0_RUNTIME_BOUNDARY_REPORT: loaderReportPath,
      },
    },
  );
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 15_000);

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  child.on("close", (exitCode, signal) => {
    clearTimeout(timeout);
    resolve({ exitCode, signal, stderr, stdout, timedOut });
  });
});

await new Promise((resolve) => server.close(resolve));

let loaderReport = {
  check: "retained-closure-runtime-module-resolution",
  status: "fail",
  violations: [],
  error: "Runtime loader did not produce a report.",
};
if (fs.existsSync(loaderReportPath)) {
  loaderReport = JSON.parse(fs.readFileSync(loaderReportPath, "utf8"));
}

const passed =
  runtimeSupported &&
  childResult.exitCode === 0 &&
  !childResult.timedOut &&
  childResult.stdout.includes("Hello World!") &&
  requests.length === 1 &&
  requests[0]?.method === "POST" &&
  requests[0]?.url?.includes("chat") &&
  JSON.stringify(requests[0]?.body ?? {}).includes("Hi") &&
  loaderReport.status === "pass" &&
  loaderReport.violations.length === 0 &&
  fs.existsSync(path.join(cliDirectory, "dist/meta.json")) &&
  Object.keys(
    JSON.parse(
      fs.readFileSync(path.join(cliDirectory, "dist/meta.json"), "utf8"),
    ).inputs ?? {},
  ).some((input) => input.includes(`${path.sep}core${path.sep}`));

const buildMetadata = fs.existsSync(path.join(cliDirectory, "dist/meta.json"))
  ? JSON.parse(
      fs.readFileSync(path.join(cliDirectory, "dist/meta.json"), "utf8"),
    )
  : { inputs: {} };
const requestBody = requests[0]?.body ?? {};
const requestSummary = requests[0]
  ? {
      method: requests[0].method,
      url: requests[0].url,
      model: requestBody.model ?? null,
      messageCount: Array.isArray(requestBody.messages)
        ? requestBody.messages.length
        : null,
      userPromptIncluded:
        Array.isArray(requestBody.messages) &&
        requestBody.messages.some(
          (message) => message?.role === "user" && message?.content === "Hi",
        ),
    }
  : null;

const report = {
  check: "retained-closure-cli-core-runtime",
  status: passed ? "pass" : "fail",
  command: `${process.execPath} --experimental-loader ${loaderPath} dist/oc.js -p --config <temporary-config> Hi`,
  workingDirectory: path.relative(repoRoot, cliDirectory),
  runtime: {
    actualNodeVersion: process.version,
    pinnedNodeVersion: `v${pinnedNodeVersion}`,
    supportedRange: SUPPORTED_NODE_RANGE,
    matchesSupportedRange: runtimeSupported,
  },
  child: {
    exitCode: childResult.exitCode,
    signal: childResult.signal,
    timedOut: childResult.timedOut,
    stdout: childResult.stdout.trim(),
    stderr: childResult.stderr.trim(),
  },
  mockTransport: {
    host: "127.0.0.1",
    requestCount: requests.length,
    request: requestSummary,
    requestShapeValid:
      requests[0]?.method === "POST" &&
      requests[0]?.url?.includes("chat") &&
      JSON.stringify(requests[0]?.body ?? {}).includes("Hi"),
  },
  coreBundled: Object.keys(buildMetadata.inputs ?? {}).some((input) =>
    input.includes(`${path.sep}core${path.sep}`),
  ),
  moduleResolution: loaderReport,
};

console.log(JSON.stringify(report, null, 2));
fs.rmSync(temporaryDirectory, { recursive: true, force: true });
process.exitCode = passed ? 0 : 1;
