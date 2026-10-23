import * as fs from "node:fs";
import * as path from "node:path";

import type { AuthOptions } from "@opencircuit/config-types";
import { CiscoCircuitApi } from "@opencircuit/openai-adapters";
import type { OpenCircuitClient } from "@opencircuit/sdk";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

import { env } from "../env.js";

export const CISCO_CIRCUIT_PROFILE_ENV = "OCIRCUIT_CISCO_PROFILE";
export const CISCO_CIRCUIT_PROFILE_PATH = path.join(
  env.ocircuitHome,
  "cisco-circuit.env",
);
export const CISCO_CIRCUIT_ISSUER = "OCIRCUIT_CISCO_ISSUER";
export const CISCO_CIRCUIT_CLIENT_ID = "OCIRCUIT_CISCO_CLIENT_ID";
export const CISCO_CIRCUIT_SCOPES = "OCIRCUIT_CISCO_SCOPES";
export const CISCO_CIRCUIT_GATEWAY_BASE = "OCIRCUIT_CISCO_GATEWAY_BASE";
export const CISCO_CIRCUIT_POLICY_PATH = "OCIRCUIT_CISCO_MODEL_POLICY_PATH";
export const CISCO_CIRCUIT_API_VERSION = "OCIRCUIT_CISCO_MODEL_API_VERSION";
export const CISCO_CIRCUIT_SECRET_REF = "OCIRCUIT_CISCO_SECRET_REF";

const APPROVED_GATEWAY_ORIGIN = "https://organon.cisco.com";
const APPROVED_GATEWAY_PATH = "/vscode-plugin";
const DEFAULT_POLICY_PATH = "/api/model-policy";
const DEFAULT_SCOPES = ["openid", "offline_access"];
const POLICY_CACHE_MS = 5 * 60 * 1000;
const MAX_POLICY_BYTES = 256 * 1024;

const profileSchema = z.object({
  issuer: z.string().url(),
  clientId: z.string().min(1).max(256),
  scopes: z.array(z.string().min(1).max(128)).min(1),
  gatewayBase: z.string().url(),
  modelPolicyPath: z.string().startsWith("/"),
  modelApiVersion: z.string().min(1).max(64),
  secretRef: z.string().min(1).max(256).optional(),
});

export interface CiscoCircuitProfile {
  issuer: string;
  clientId: string;
  scopes: string[];
  gatewayBase: string;
  modelPolicyPath: string;
  modelApiVersion: string;
  secretRef?: string;
}

const policyEntrySchema = z.union([
  z.string().min(1).max(200),
  z
    .object({
      id: z.string().min(1).max(200),
      deployment: z.string().min(1).max(200).optional(),
    })
    .strict(),
]);

const policySchema = z
  .object({ models: z.array(policyEntrySchema).min(1).max(100) })
  .strict();

export type CiscoModelPolicy = z.infer<typeof policySchema>;

export function loadCiscoCircuitProfile(
  profilePath = process.env[CISCO_CIRCUIT_PROFILE_ENV] ??
    CISCO_CIRCUIT_PROFILE_PATH,
): CiscoCircuitProfile {
  const metadata = fs.lstatSync(profilePath);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new Error("Cisco profile must be a regular file with mode 0600");
  }
  const parsed = loadDotenv({ path: profilePath, processEnv: {} }).parsed ?? {};
  const profile = profileSchema.parse({
    issuer: parsed[CISCO_CIRCUIT_ISSUER],
    clientId: parsed[CISCO_CIRCUIT_CLIENT_ID],
    scopes: parseScopes(parsed[CISCO_CIRCUIT_SCOPES]),
    gatewayBase: parsed[CISCO_CIRCUIT_GATEWAY_BASE],
    modelPolicyPath: parsed[CISCO_CIRCUIT_POLICY_PATH] ?? DEFAULT_POLICY_PATH,
    modelApiVersion: parsed[CISCO_CIRCUIT_API_VERSION],
    secretRef: parsed[CISCO_CIRCUIT_SECRET_REF],
  });
  validateIssuer(profile.issuer);
  validateGatewayBase(profile.gatewayBase);
  if (profile.modelPolicyPath.includes("?")) {
    throw new Error("Cisco model policy path must not contain a query string");
  }
  return profile;
}

export function resolveCiscoCircuitAuth(
  auth: AuthOptions,
  profilePath?: string,
): AuthOptions {
  if (auth.profile !== "cisco-circuit") return auth;
  const profile = loadCiscoCircuitProfile(profilePath);
  return {
    ...auth,
    enabled: true,
    profile: "cisco-circuit",
    issuer: profile.issuer,
    clientId: profile.clientId,
    scopes: profile.scopes,
    gatewayBase: profile.gatewayBase,
    modelPolicyPath: profile.modelPolicyPath,
    modelApiVersion: profile.modelApiVersion,
    secretRef: profile.secretRef,
    redirectPort: 0,
    redirectPath: "/oauth/callback",
  };
}

export interface CiscoCircuitGatewayOptions {
  fetch?: typeof fetch;
  now?: () => number;
}

export class CiscoCircuitGateway {
  private policy: CiscoModelPolicy | undefined;
  private policyExpiresAt = 0;
  private policyInFlight: Promise<CiscoModelPolicy> | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(
    private readonly client: OpenCircuitClient,
    private readonly auth: AuthOptions,
    options: CiscoCircuitGatewayOptions = {},
  ) {
    if (auth.profile !== "cisco-circuit") {
      throw new Error("Cisco gateway requires the cisco-circuit auth profile");
    }
    if (!auth.gatewayBase || !auth.modelPolicyPath || !auth.modelApiVersion) {
      throw new Error("Cisco gateway contract is incomplete");
    }
    validateGatewayBase(auth.gatewayBase);
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  createLlmApi(model: string): CiscoCircuitApi {
    const base = new URL(
      `api/llm/openai/deployments/${encodeURIComponent(model)}/`,
      ensureTrailingSlash(this.auth.gatewayBase!),
    );
    return new CiscoCircuitApi(
      base.toString(),
      async () => {
        const policy = await this.getPolicy();
        const entry = policy.models.find((candidate) =>
          typeof candidate === "string"
            ? candidate === model
            : candidate.id === model,
        );
        if (!entry) throw new Error(`Cisco model is not entitled: ${model}`);
        const token = await this.client.getAccessToken();
        if (!token) throw new Error("Cisco Circuit authentication is required");
        return token;
      },
      this.auth.modelApiVersion!,
      this.fetchImpl,
    );
  }

  async getPolicy(): Promise<CiscoModelPolicy> {
    if (this.policy && this.policyExpiresAt > this.now()) return this.policy;
    if (this.policyInFlight) return this.policyInFlight;
    this.policyInFlight = this.fetchPolicy().finally(() => {
      this.policyInFlight = undefined;
    });
    return this.policyInFlight;
  }

  clearPolicyCache(): void {
    this.policy = undefined;
    this.policyExpiresAt = 0;
  }

  private async fetchPolicy(): Promise<CiscoModelPolicy> {
    const url = new URL(
      this.auth.modelPolicyPath!.replace(/^\//, ""),
      ensureTrailingSlash(this.auth.gatewayBase!),
    );
    validateGatewayRequest(url);
    const token = await this.client.getAccessToken();
    if (!token) throw new Error("Cisco Circuit authentication is required");
    const response = await this.fetchImpl(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(`Cisco model policy failed: ${response.status}`);
    const text = await readBoundedBody(response);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("Cisco model policy was not valid JSON");
    }
    const policy = policySchema.parse(payload);
    const ids = policy.models.map((entry) =>
      typeof entry === "string" ? entry : entry.id,
    );
    if (new Set(ids).size !== ids.length)
      throw new Error("Cisco model policy contains duplicate IDs");
    this.policy = policy;
    this.policyExpiresAt = this.now() + POLICY_CACHE_MS;
    return policy;
  }
}

function parseScopes(value: string | undefined): string[] {
  const scopes = (value ?? DEFAULT_SCOPES.join(" "))
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return scopes.length > 0 ? scopes : DEFAULT_SCOPES;
}

function validateIssuer(value: string): void {
  const issuer = new URL(value);
  if (
    issuer.protocol !== "https:" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash
  ) {
    throw new Error(
      "Cisco issuer must be an HTTPS URL without credentials or query data",
    );
  }
}

function validateGatewayBase(value: string): void {
  const gateway = new URL(value);
  if (
    gateway.origin !== APPROVED_GATEWAY_ORIGIN ||
    gateway.protocol !== "https:" ||
    gateway.pathname.replace(/\/$/, "") !== APPROVED_GATEWAY_PATH ||
    gateway.username ||
    gateway.password ||
    gateway.search ||
    gateway.hash
  ) {
    throw new Error("Cisco gateway is not the approved HTTPS route");
  }
}

function validateGatewayRequest(url: URL): void {
  if (
    url.origin !== APPROVED_GATEWAY_ORIGIN ||
    url.protocol !== "https:" ||
    !url.pathname.startsWith(`${APPROVED_GATEWAY_PATH}/`) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Cisco gateway request is outside the approved route");
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

async function readBoundedBody(response: Response): Promise<string> {
  const length = response.headers.get("content-length");
  if (length && Number(length) > MAX_POLICY_BYTES)
    throw new Error("Cisco model policy is oversized");
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_POLICY_BYTES)
    throw new Error("Cisco model policy is oversized");
  return text;
}
