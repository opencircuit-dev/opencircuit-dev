#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APPROVED_ORIGIN = "https://organon.cisco.com";
const APPROVED_BASE_PATH = "/vscode-plugin";
const DEFAULT_PROFILE = path.join(
  os.homedir(),
  ".ocircuit",
  "cisco-circuit.env",
);
const MAX_POLICY_BYTES = 256 * 1024;

const { mode, options } = parseArgs(process.argv.slice(2));
const output = {};

try {
  if (mode === "inspect" || mode === "all") {
    if (!options.vsix && mode === "inspect")
      fail("--vsix is required for inspect");
    if (options.vsix) output.inspect = inspectVsix(options.vsix);
  }
  if (mode === "discovery" || mode === "all") {
    const profile = readProfile(options.profile);
    output.discovery = await discover(profile);
  }
  if (mode === "login" || mode === "all") {
    const profile = readProfile(options.profile);
    output.login = await login(profile);
  }
  if (mode === "policy" || mode === "all") {
    const profile = readProfile(options.profile);
    output.policy = await policy(profile);
  }
  if (mode === "capabilities") {
    const profile = readProfile(options.profile);
    output.capabilities = await capabilities(profile, options.models);
    if (output.capabilities.failures.length > 0) {
      fail(
        `Cisco model capability validation failed for ${output.capabilities.failures.join(", ")}`,
      );
    }
  }
  writeOutput(options.output, { status: "pass", mode, ...output });
} catch (error) {
  writeOutput(options.output, {
    status: "fail",
    mode,
    failure: error instanceof Error ? error.message : "probe failed",
    ...output,
  });
  process.exitCode = 1;
}

function parseArgs(args) {
  const [mode = ""] = args;
  if (
    ![
      "inspect",
      "discovery",
      "login",
      "policy",
      "capabilities",
      "all",
    ].includes(mode)
  ) {
    fail(
      "usage: cisco-contract-probe <inspect|discovery|login|policy|capabilities|all> [options]",
    );
  }
  const options = {};
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) fail(`unexpected argument: ${argument}`);
    const key = argument.slice(2);
    if (key === "model") {
      const value = args[++index];
      if (!value || value.startsWith("--"))
        fail(`${argument} requires a value`);
      options.models = [...(options.models ?? []), value];
    } else if (key === "output" || key === "profile" || key === "vsix") {
      const value = args[++index];
      if (!value || value.startsWith("--"))
        fail(`${argument} requires a value`);
      options[key] = value;
    } else {
      fail(`unknown option: ${argument}`);
    }
  }
  return { mode, options };
}

function readProfile(
  profilePath = process.env.OCIRCUIT_CISCO_PROFILE ?? DEFAULT_PROFILE,
) {
  const stat = fs.lstatSync(profilePath);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
    fail("Cisco profile must be a regular file with mode 0600");
  }
  const values = parseEnv(fs.readFileSync(profilePath, "utf8"));
  const profile = {
    issuer: required(values, "OCIRCUIT_CISCO_ISSUER"),
    clientId: required(values, "OCIRCUIT_CISCO_CLIENT_ID"),
    scopes: (values.OCIRCUIT_CISCO_SCOPES ?? "openid offline_access")
      .split(/\s+/)
      .filter(Boolean),
    gatewayBase: required(values, "OCIRCUIT_CISCO_GATEWAY_BASE"),
    modelPolicyPath:
      values.OCIRCUIT_CISCO_MODEL_POLICY_PATH ?? "/api/model-policy",
    modelApiVersion: required(values, "OCIRCUIT_CISCO_MODEL_API_VERSION"),
  };
  const issuer = new URL(profile.issuer);
  const gateway = new URL(profile.gatewayBase);
  if (
    issuer.protocol !== "https:" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash
  ) {
    fail("Cisco issuer is not a valid HTTPS issuer");
  }
  if (
    gateway.origin !== APPROVED_ORIGIN ||
    gateway.protocol !== "https:" ||
    gateway.pathname.replace(/\/$/, "") !== APPROVED_BASE_PATH ||
    gateway.username ||
    gateway.password ||
    gateway.search ||
    gateway.hash
  ) {
    fail("Cisco gateway is not the approved HTTPS route");
  }
  if (
    !profile.modelPolicyPath.startsWith("/") ||
    profile.modelPolicyPath.includes("?")
  ) {
    fail("Cisco model policy path is invalid");
  }
  return profile;
}

function inspectVsix(vsixPath) {
  if (!vsixPath.endsWith(".vsix")) fail("inspect accepts only a .vsix file");
  const listing = execFileSync("unzip", ["-Z1", vsixPath], {
    encoding: "utf8",
  });
  const files = listing.split("\n").filter(Boolean).slice(0, 2_000);
  const candidates = [];
  for (const file of files) {
    if (!/\.(js|json|yaml|yml|ts)$/i.test(file)) continue;
    const content = execFileSync("unzip", ["-p", vsixPath, file], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    const patterns = [
      /https:\/\/[^\s"'`]+/g,
      /(?:issuer|authority|client[_-]?id|scope|model-policy|api-version)[^\n]{0,180}/gi,
    ];
    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) {
        const value = sanitizeCandidate(match[0]);
        if (value)
          candidates.push({
            file,
            offset: match.index,
            value,
            status: "candidate",
          });
      }
    }
  }
  return {
    artifact: path.basename(vsixPath),
    sha256: sha256(vsixPath),
    candidates: uniqueCandidates(candidates),
  };
}

async function discover(profile) {
  const issuer = new URL(profile.issuer);
  const endpoint = new URL(
    ".well-known/openid-configuration",
    `${issuer.toString().replace(/\/$/, "")}/`,
  );
  const response = await fetch(endpoint, {
    redirect: "error",
    headers: { Accept: "application/json" },
  });
  if (!response.ok)
    fail(`OIDC discovery failed with status ${response.status}`);
  const metadata = await response.json();
  if (!metadata || metadata.issuer !== issuer.toString().replace(/\/$/, ""))
    fail("OIDC discovery issuer mismatch");
  const endpoints = [
    "authorization_endpoint",
    "token_endpoint",
    "revocation_endpoint",
    "jwks_uri",
  ]
    .filter((key) => metadata[key])
    .map((key) => ({
      name: key,
      route: endpointSummary(metadata[key], issuer),
    }));
  if (
    !metadata.authorization_endpoint ||
    !metadata.token_endpoint ||
    !metadata.jwks_uri
  )
    fail("OIDC discovery omitted a required endpoint");
  return {
    issuer: endpointSummary(metadata.issuer, issuer),
    endpoints,
    responseTypes: Array.isArray(metadata.response_types_supported)
      ? metadata.response_types_supported
      : [],
    grantTypes: Array.isArray(metadata.grant_types_supported)
      ? metadata.grant_types_supported
      : [],
  };
}

async function login(profile) {
  const sdk = await import(path.resolve("packages/sdk/dist/index.js"));
  const store = new sdk.OsTokenStore(
    `OpenCircuit/${profile.issuer}`,
    profile.clientId,
  );
  const client = new sdk.OpenCircuitClient({ tokenStore: store });
  client.configureAuth({
    auth: {
      enabled: true,
      profile: "cisco-circuit",
      ...profile,
      redirectPort: 0,
      redirectPath: "/oauth/callback",
    },
  });
  const token =
    (await client.getAccessToken()) ??
    (
      await client.authenticate({
        auth: {
          enabled: true,
          profile: "cisco-circuit",
          ...profile,
          redirectPort: 0,
          redirectPath: "/oauth/callback",
        },
      })
    )?.accessToken;
  if (!token) fail("OAuth login did not produce an access token");
  const stored = await store.load();
  return {
    tokenPresent: true,
    expiresAt: stored?.expiresAt ?? null,
    issuer: endpointSummary(profile.issuer, new URL(profile.issuer)),
  };
}

async function policy(profile) {
  const sdk = await import(path.resolve("packages/sdk/dist/index.js"));
  const store = new sdk.OsTokenStore(
    `OpenCircuit/${profile.issuer}`,
    profile.clientId,
  );
  const client = new sdk.OpenCircuitClient({ tokenStore: store });
  client.configureAuth({
    auth: {
      enabled: true,
      profile: "cisco-circuit",
      ...profile,
      redirectPort: 0,
      redirectPath: "/oauth/callback",
    },
  });
  const token = await client.getAccessToken();
  if (!token) fail("No stored OAuth session; run login first");
  const url = new URL(
    profile.modelPolicyPath.replace(/^\//, ""),
    `${profile.gatewayBase.replace(/\/$/, "")}/`,
  );
  const response = await fetch(url, {
    redirect: "error",
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (!response.ok) fail(`model policy failed with status ${response.status}`);
  const body = await response.text();
  if (Buffer.byteLength(body) > MAX_POLICY_BYTES)
    fail("model policy is oversized");
  const payload = JSON.parse(body);
  if (
    !payload ||
    !Array.isArray(payload.models) ||
    payload.models.length === 0 ||
    payload.models.length > 100
  )
    fail("model policy shape is invalid");
  const entries = payload.models.map(normalizePolicyEntry);
  if (
    entries.some((entry) => !entry.id) ||
    new Set(entries.map((entry) => entry.id)).size !== entries.length
  ) {
    fail("model policy contains invalid or duplicate IDs");
  }
  const models = entries.filter((entry) => entry.available !== false);
  if (models.length === 0) fail("model policy contains no available models");
  return {
    status: response.status,
    route: endpointSummary(url.toString(), new URL(profile.gatewayBase)),
    models: models.map((entry) => entry.id),
    unavailableModels: entries
      .filter((entry) => entry.available === false)
      .map((entry) => entry.id),
    entries,
    digest: sha256String(body),
  };
}

async function capabilities(profile, requestedModels = []) {
  const policyReport = await policy(profile);
  const selected = requestedModels.length
    ? policyReport.models.filter((model) => requestedModels.includes(model))
    : policyReport.models;
  const unknown = requestedModels.filter(
    (model) => !policyReport.models.includes(model),
  );
  if (unknown.length) {
    fail(`requested model is not available in policy: ${unknown.join(", ")}`);
  }

  const token = await getStoredToken(profile);
  const results = [];
  for (const model of selected) {
    const entry = policyReport.entries.find(
      (candidate) => candidate.id === model,
    );
    const deployment = entry?.deployment ?? model;
    for (const stream of [false, true]) {
      const url = new URL(
        `api/llm/openai/deployments/${encodeURIComponent(deployment)}/chat/completions`,
        `${profile.gatewayBase.replace(/\/$/, "")}/`,
      );
      url.searchParams.set("api-version", profile.modelApiVersion);
      const response = await fetch(url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        headers: {
          Accept: stream ? "text/event-stream" : "application/json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: "Reply with exactly OK." }],
          model: deployment,
          max_tokens: 1,
          stream,
        }),
      });
      const body = await response.text();
      results.push({
        model,
        deployment,
        stream,
        status: response.status,
        contentType: response.headers.get("content-type"),
        contentPresent: body.trim().length > 0,
      });
    }
  }
  return {
    status: results.every(
      (result) => result.status >= 200 && result.status < 300,
    )
      ? "pass"
      : "fail",
    models: selected,
    results,
    failures: results
      .filter((result) => result.status < 200 || result.status >= 300)
      .map(
        (result) =>
          `${result.model}/${result.stream ? "stream" : "chat"}:${result.status}`,
      ),
  };
}

function normalizePolicyEntry(entry) {
  if (typeof entry === "string") return { id: entry };
  if (!entry || typeof entry !== "object") return { id: null };
  return {
    id: entry.id ?? entry.model,
    deployment: entry.deployment,
    available: entry.available,
  };
}

async function getStoredToken(profile) {
  const sdk = await import(path.resolve("packages/sdk/dist/index.js"));
  const store = new sdk.OsTokenStore(
    `OpenCircuit/${profile.issuer}`,
    profile.clientId,
  );
  const client = new sdk.OpenCircuitClient({ tokenStore: store });
  client.configureAuth({
    auth: {
      enabled: true,
      profile: "cisco-circuit",
      ...profile,
      redirectPort: 0,
      redirectPath: "/oauth/callback",
    },
  });
  const token = await client.getAccessToken();
  if (!token) fail("No stored OAuth session; run login first");
  return token;
}

function parseEnv(content) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/,
    );
    if (!match) continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

function required(values, key) {
  if (!values[key]) fail(`Cisco profile is missing ${key}`);
  return values[key];
}

function endpointSummary(value, trusted) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    url.hostname !== "127.0.0.1" &&
    url.hostname !== "localhost"
  )
    fail("endpoint must use HTTPS");
  if (trusted && url.hostname !== trusted.hostname)
    fail("discovered endpoint host is not trusted");
  return { host: url.hostname, path: url.pathname };
}

function sanitizeCandidate(value) {
  if (
    !value ||
    value.length > 220 ||
    /Bearer\s|eyJ[A-Za-z0-9_-]+\./i.test(value)
  )
    return null;
  return value.replace(
    /([?&](?:token|key|secret|authorization))=[^&\s]+/gi,
    "$1=<redacted>",
  );
}

function uniqueCandidates(candidates) {
  return [
    ...new Map(
      candidates.map((entry) => [
        `${entry.file}:${entry.offset}:${entry.value}`,
        entry,
      ]),
    ).values(),
  ];
}

function sha256(file) {
  return sha256String(fs.readFileSync(file));
}

function sha256String(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeOutput(file, report) {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (file) fs.writeFileSync(file, text, { mode: 0o600 });
  else process.stdout.write(text);
}

function fail(message) {
  throw new Error(message);
}
