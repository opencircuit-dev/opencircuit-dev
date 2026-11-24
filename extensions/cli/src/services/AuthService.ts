import * as fs from "node:fs";

import {
  authOptionsSchema,
  type AuthOptions,
  type ConfigJson,
} from "@opencircuit/config-types";
import {
  MemoryTokenStore,
  OpenCircuitClient,
  TokenStoreUnavailable,
  createOAuthTokenStore,
} from "@opencircuit/sdk";
import YAML from "yaml";

import {
  CiscoCircuitGateway,
  resolveCiscoCircuitAuth,
} from "../auth/ciscoCircuit.js";
import { env } from "../env.js";
import { logger } from "../util/logger.js";

import { BaseService } from "./BaseService.js";
import { AuthServiceState } from "./types.js";

/** Owns the single SDK auth client and never exposes token values in state. */
export class AuthService extends BaseService<AuthServiceState> {
  private client: OpenCircuitClient | undefined;
  private authOptions: AuthOptions | undefined;
  private gateway: CiscoCircuitGateway | undefined;
  private configPath: string | undefined;
  private headless = false;

  constructor() {
    super("AuthService", { authConfig: null, isAuthenticated: false });
  }

  async doInitialize(
    configPath?: string,
    isHeadless = false,
  ): Promise<AuthServiceState> {
    this.configPath = configPath;
    this.headless = isHeadless;
    this.client = undefined;
    this.authOptions = undefined;
    this.gateway = undefined;

    const localConfigPath = resolveLocalConfigPath(configPath);
    if (!localConfigPath) return this.unauthenticated("no local auth config");

    const raw = YAML.parse(fs.readFileSync(localConfigPath, "utf8")) as {
      auth?: unknown;
    };
    const parsed = authOptionsSchema.parse(raw.auth ?? {});
    if (!parsed.enabled) return this.unauthenticated("authentication disabled");

    const resolved = resolveCiscoCircuitAuth(parsed);
    this.authOptions = authOptionsSchema.parse(resolved);
    this.client = new OpenCircuitClient({
      tokenStore: createOAuthTokenStore(this.authOptions),
    });
    this.client.configureAuth({ auth: this.authOptions } as ConfigJson);

    let accessToken: string | null;
    try {
      accessToken = await this.client.getAccessToken();
    } catch (error) {
      if (!(error instanceof TokenStoreUnavailable)) throw error;
      logger.warn(
        "OS credential storage is unavailable; using memory-only OAuth state",
      );
      this.client = new OpenCircuitClient({
        tokenStore: new MemoryTokenStore(),
      });
      this.client.configureAuth({ auth: this.authOptions } as ConfigJson);
      accessToken = null;
    }

    if (!accessToken) {
      if (this.headless) {
        throw new Error(
          "No stored OAuth session. Run `oc` interactively once to complete Cisco SSO.",
        );
      }
      await this.client.authenticate({ auth: this.authOptions } as ConfigJson);
      accessToken = await this.client.getAccessToken();
    }

    if (this.authOptions.profile === "cisco-circuit") {
      this.gateway = new CiscoCircuitGateway(
        () => this.client?.getAccessToken() ?? Promise.resolve(null),
        this.authOptions,
      );
    }
    return this.state(accessToken !== null);
  }

  async login(): Promise<AuthServiceState> {
    if (!this.client || !this.authOptions) {
      throw new Error("OAuth is not configured");
    }
    await this.client.authenticate({ auth: this.authOptions } as ConfigJson);
    return this.state(true);
  }

  async logout(): Promise<AuthServiceState> {
    if (this.client) await this.client.logout();
    this.gateway?.clearPolicyCache();
    return this.unauthenticated("logged out");
  }

  async ensureOrganization(
    _isHeadless = false,
    _cliOrganizationSlug?: string,
  ): Promise<AuthServiceState> {
    return this.getState();
  }

  async switchOrganization(
    _organizationId: string | null,
  ): Promise<AuthServiceState> {
    return this.getState();
  }

  async getAvailableOrganizations(): Promise<null> {
    return null;
  }

  async hasMultipleOrganizations(): Promise<boolean> {
    return false;
  }

  async refresh(): Promise<AuthServiceState> {
    if (!this.client) return this.reload(this.configPath, this.headless);
    const accessToken = await this.client.getAccessToken();
    return this.state(accessToken !== null);
  }

  private state(isAuthenticated: boolean): AuthServiceState {
    return {
      authConfig: null,
      isAuthenticated,
      ...(this.client && this.authOptions?.profile !== "cisco-circuit"
        ? { apiClient: this.client }
        : {}),
      ...(this.authOptions ? { authOptions: this.authOptions } : {}),
      ...(this.gateway ? { gateway: this.gateway } : {}),
    };
  }

  private unauthenticated(reason: string): AuthServiceState {
    logger.debug(`AuthService initialized (${reason})`);
    return { authConfig: null, isAuthenticated: false };
  }
}

function resolveLocalConfigPath(configPath?: string): string | undefined {
  const candidate = configPath ?? `${env.ocircuitHome}/config.yaml`;
  try {
    const stat = fs.statSync(candidate);
    return stat.isFile() ? candidate : undefined;
  } catch {
    return undefined;
  }
}
