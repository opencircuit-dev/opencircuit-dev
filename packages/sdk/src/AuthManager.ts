import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import type { AuthOptions, ConfigJson } from "@opencircuit/config-types";
import { authOptionsSchema } from "@opencircuit/config-types";
import { createRemoteJWKSet, jwtVerify } from "jose";

const DEFAULT_REDIRECT_PATH = "/oauth/callback";
const DEFAULT_TIMEOUT_MS = 120_000;
const TOKEN_EXPIRY_SKEW_MS = 60_000;

interface ProviderMetadata {
  issuer?: string;
  authorizationEndpoint: URL;
  tokenEndpoint: URL;
  revocationEndpoint?: URL;
  jwksUri?: URL;
}

interface TokenResponse {
  access_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  scope?: unknown;
  id_token?: unknown;
}

export interface OAuthTokenSet {
  accessToken: string;
  tokenType: "Bearer";
  expiresAt: number;
  refreshToken?: string;
  scope?: string;
  idToken?: string;
}

/** Implement this with an OS keychain when persistence across processes is needed. */
export interface SecureTokenStore {
  load(): Promise<OAuthTokenSet | null>;
  save(tokenSet: OAuthTokenSet): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryTokenStore implements SecureTokenStore {
  private tokenSet: OAuthTokenSet | null = null;

  async load(): Promise<OAuthTokenSet | null> {
    return this.tokenSet;
  }

  async save(tokenSet: OAuthTokenSet): Promise<void> {
    this.tokenSet = tokenSet;
  }

  async clear(): Promise<void> {
    this.tokenSet = null;
  }
}

export interface AuthManagerOptions {
  fetch?: typeof fetch;
  openBrowser?: (url: string) => void;
  now?: () => number;
  timeoutMs?: number;
  tokenStore?: SecureTokenStore;
}

export class OAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

interface AuthorizationFlow {
  code: string;
  codeVerifier: string;
  nonce?: string;
  redirectUri: string;
  state: string;
}

export class AuthManager {
  private readonly auth: AuthOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly openBrowserImpl: (url: string) => void;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly tokenStore: SecureTokenStore;
  private refreshInFlight: Promise<OAuthTokenSet> | undefined;

  constructor(config: ConfigJson, options: AuthManagerOptions = {}) {
    this.auth = authOptionsSchema.parse(config.auth ?? {});
    this.fetchImpl = options.fetch ?? fetch;
    this.openBrowserImpl =
      options.openBrowser ?? ((url) => this.openBrowser(url));
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.tokenStore = options.tokenStore ?? new MemoryTokenStore();
  }

  async authenticate(): Promise<OAuthTokenSet | null> {
    if (!this.auth.enabled) return null;

    const metadata = await this.resolveProviderMetadata();
    const flow = await this.waitForAuthorizationCode(metadata);
    const tokenSet = await this.exchangeToken(metadata, {
      code: flow.code,
      codeVerifier: flow.codeVerifier,
      grantType: "authorization_code",
      nonce: flow.nonce,
      redirectUri: flow.redirectUri,
    });

    await this.tokenStore.save(tokenSet);
    return tokenSet;
  }

  async getAccessToken(): Promise<string | null> {
    const tokenSet = await this.tokenStore.load();
    if (!tokenSet) return null;

    if (tokenSet.expiresAt > this.now() + TOKEN_EXPIRY_SKEW_MS) {
      return tokenSet.accessToken;
    }

    if (!tokenSet.refreshToken) return null;

    const refreshed = await this.refreshStoredToken(tokenSet.refreshToken);
    return refreshed.accessToken;
  }

  async refreshToken(refreshToken?: string): Promise<OAuthTokenSet> {
    return this.refreshStoredToken(refreshToken);
  }

  private async refreshStoredToken(
    refreshToken?: string,
  ): Promise<OAuthTokenSet> {
    if (this.refreshInFlight) return this.refreshInFlight;

    const refresh = this.performRefresh(refreshToken);
    this.refreshInFlight = refresh.finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  private async performRefresh(refreshToken?: string): Promise<OAuthTokenSet> {
    const metadata = await this.resolveProviderMetadata();
    const current = await this.tokenStore.load();
    const requestedRefreshToken = refreshToken ?? current?.refreshToken;
    if (!requestedRefreshToken) {
      throw new OAuthError("No refresh token is available");
    }
    const tokenSet = await this.exchangeToken(metadata, {
      grantType: "refresh_token",
      refreshToken: requestedRefreshToken,
    });

    await this.tokenStore.save({
      ...tokenSet,
      refreshToken: tokenSet.refreshToken ?? current?.refreshToken,
    });
    const saved = await this.tokenStore.load();
    if (!saved)
      throw new OAuthError("OAuth token store did not save the token");
    return saved;
  }

  async revoke(): Promise<boolean> {
    const current = await this.tokenStore.load();
    if (!current) return true;

    try {
      const metadata = await this.resolveProviderMetadata();
      if (!metadata.revocationEndpoint) return false;

      const body = new URLSearchParams({
        token: current.accessToken,
        token_type_hint: "access_token",
      });
      const response = await this.fetchImpl(metadata.revocationEndpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
        redirect: "error",
      });

      if (!response.ok) {
        throw new OAuthError(
          `OAuth revocation failed with status ${response.status}`,
          response.status,
        );
      }
      return true;
    } finally {
      await this.tokenStore.clear();
    }
  }

  async clear(): Promise<void> {
    await this.tokenStore.clear();
  }

  private async resolveProviderMetadata(): Promise<ProviderMetadata> {
    if (this.auth.issuer) {
      const issuer = validateEndpoint(this.auth.issuer, true);
      const discoveryUrl = new URL(
        ".well-known/openid-configuration",
        `${issuer.toString().replace(/\/$/, "")}/`,
      );
      const discovery = await this.fetchJson(discoveryUrl);

      if (
        typeof discovery.issuer !== "string" ||
        normalizeUrl(discovery.issuer) !== normalizeUrl(issuer.toString())
      ) {
        throw new OAuthError(
          "OIDC discovery issuer does not match configuration",
        );
      }

      const authorizationEndpoint = this.trustedEndpoint(
        discovery.authorization_endpoint,
        issuer,
      );
      const tokenEndpoint = this.trustedEndpoint(
        discovery.token_endpoint,
        issuer,
      );
      const revocationEndpoint = discovery.revocation_endpoint
        ? this.trustedEndpoint(discovery.revocation_endpoint, issuer)
        : undefined;
      const jwksUri = discovery.jwks_uri
        ? this.trustedEndpoint(discovery.jwks_uri, issuer)
        : undefined;

      return {
        issuer: normalizeUrl(issuer.toString()),
        authorizationEndpoint,
        tokenEndpoint,
        revocationEndpoint,
        jwksUri,
      };
    }

    return {
      authorizationEndpoint: this.explicitEndpoint(
        this.auth.authorizationEndpoint,
      ),
      tokenEndpoint: this.explicitEndpoint(this.auth.tokenEndpoint),
      revocationEndpoint: this.auth.revocationEndpoint
        ? this.explicitEndpoint(this.auth.revocationEndpoint)
        : undefined,
    };
  }

  private trustedEndpoint(value: unknown, issuer: URL): URL {
    if (typeof value !== "string") {
      throw new OAuthError("OIDC discovery omitted a required endpoint");
    }

    const endpoint = validateEndpoint(value, isLoopback(issuer.hostname));
    const trustedHosts = new Set([
      issuer.hostname,
      ...(this.auth.trustedHosts ?? []),
    ]);
    if (!trustedHosts.has(endpoint.hostname)) {
      throw new OAuthError(
        "OIDC endpoint host is not trusted by the authentication configuration",
      );
    }
    return endpoint;
  }

  private explicitEndpoint(value: string | undefined): URL {
    if (!value) {
      throw new OAuthError(
        "OAuth endpoint is missing from authentication configuration",
      );
    }
    return validateEndpoint(value, true);
  }

  private async waitForAuthorizationCode(
    metadata: ProviderMetadata,
  ): Promise<AuthorizationFlow> {
    const codeVerifier = randomBase64Url(32);
    const state = randomBase64Url(32);
    const nonce = metadata.issuer ? randomBase64Url(32) : undefined;
    const redirectPath = this.auth.redirectPath ?? DEFAULT_REDIRECT_PATH;
    const server = createServer();

    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        finishReject(new OAuthError("OAuth authorization timed out"));
      }, this.timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        if (server.listening) server.close();
      };
      const finishResolve = (value: AuthorizationFlow) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };

      server.on("request", (request, response) => {
        try {
          if (request.method !== "GET") {
            response.writeHead(405, {
              Allow: "GET",
              "Cache-Control": "no-store",
            });
            response.end();
            return;
          }

          const url = new URL(request.url ?? "/", "http://127.0.0.1");
          if (url.pathname !== redirectPath) {
            response.writeHead(404, { "Cache-Control": "no-store" });
            response.end();
            return;
          }

          const returnedState = url.searchParams.get("state");
          if (!returnedState || !constantTimeEqual(returnedState, state)) {
            response.writeHead(400, { "Cache-Control": "no-store" });
            response.end("Authentication was not completed.");
            throw new OAuthError("OAuth state validation failed");
          }

          const error = url.searchParams.get("error");
          if (error) {
            response.writeHead(400, { "Cache-Control": "no-store" });
            response.end("Authentication was not completed.");
            throw new OAuthError("OAuth authorization was denied");
          }

          const code = url.searchParams.get("code");
          if (!code) {
            response.writeHead(400, { "Cache-Control": "no-store" });
            response.end("Authentication was not completed.");
            throw new OAuthError("OAuth authorization code is missing");
          }

          response.writeHead(200, {
            "Cache-Control": "no-store",
            "Content-Security-Policy":
              "default-src 'none'; frame-ancestors 'none'",
            "Content-Type": "text/plain; charset=utf-8",
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
          });
          response.end("Authentication successful. You can close this window.");
          finishResolve({
            code,
            codeVerifier,
            nonce,
            redirectUri: currentRedirectUri(server, redirectPath),
            state,
          });
        } catch (error) {
          finishReject(
            error instanceof Error
              ? error
              : new OAuthError("OAuth callback failed"),
          );
        }
      });

      server.on("error", (error) => {
        finishReject(
          new OAuthError(`Local OAuth server error: ${error.message}`),
        );
      });

      server.listen(
        { host: "127.0.0.1", port: this.auth.redirectPort ?? 0 },
        () => {
          try {
            const redirectUri = currentRedirectUri(server, redirectPath);
            const authorizationUrl = new URL(metadata.authorizationEndpoint);
            authorizationUrl.searchParams.set(
              "client_id",
              this.requireClientId(),
            );
            authorizationUrl.searchParams.set("redirect_uri", redirectUri);
            authorizationUrl.searchParams.set("response_type", "code");
            const scopes =
              this.auth.scopes ?? (metadata.issuer ? ["openid"] : []);
            if (scopes.length > 0) {
              authorizationUrl.searchParams.set("scope", scopes.join(" "));
            }
            authorizationUrl.searchParams.set("state", state);
            authorizationUrl.searchParams.set(
              "code_challenge",
              codeChallenge(codeVerifier),
            );
            authorizationUrl.searchParams.set("code_challenge_method", "S256");
            if (nonce) authorizationUrl.searchParams.set("nonce", nonce);
            this.openBrowserImpl(authorizationUrl.toString());
          } catch (error) {
            finishReject(
              error instanceof Error
                ? error
                : new OAuthError("OAuth startup failed"),
            );
          }
        },
      );
    });
  }

  private async exchangeToken(
    metadata: ProviderMetadata,
    request: {
      code?: string;
      codeVerifier?: string;
      grantType: "authorization_code" | "refresh_token";
      nonce?: string;
      refreshToken?: string;
      redirectUri?: string;
    },
  ): Promise<OAuthTokenSet> {
    const body = new URLSearchParams({
      client_id: this.requireClientId(),
      grant_type: request.grantType,
    });
    if (request.code) body.set("code", request.code);
    if (request.codeVerifier) body.set("code_verifier", request.codeVerifier);
    if (request.redirectUri) body.set("redirect_uri", request.redirectUri);
    if (request.refreshToken) body.set("refresh_token", request.refreshToken);

    const response = await this.fetchImpl(metadata.tokenEndpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      redirect: "error",
    });
    if (!response.ok) {
      throw new OAuthError(
        `OAuth token request failed with status ${response.status}`,
        response.status,
      );
    }

    let payload: TokenResponse;
    try {
      payload = (await response.json()) as TokenResponse;
    } catch {
      throw new OAuthError("OAuth token response was not valid JSON");
    }

    const tokenSet = this.parseTokenResponse(payload);
    if (
      metadata.issuer &&
      request.grantType === "authorization_code" &&
      !tokenSet.idToken
    ) {
      throw new OAuthError("OIDC token response omitted id_token");
    }
    if (metadata.issuer && tokenSet.idToken) {
      if (!metadata.jwksUri) {
        throw new OAuthError("OIDC provider did not publish a JWKS endpoint");
      }
      const jwks = createRemoteJWKSet(metadata.jwksUri);
      const verified = await jwtVerify(tokenSet.idToken, jwks, {
        audience: this.requireClientId(),
        issuer: metadata.issuer,
      });
      if (
        request.grantType === "authorization_code" &&
        verified.payload.nonce !== request.nonce
      ) {
        throw new OAuthError("OIDC nonce validation failed");
      }
    }
    return tokenSet;
  }

  private parseTokenResponse(payload: TokenResponse): OAuthTokenSet {
    if (
      typeof payload.access_token !== "string" ||
      payload.access_token.length === 0
    ) {
      throw new OAuthError("OAuth token response omitted access_token");
    }
    if (
      typeof payload.token_type !== "string" ||
      payload.token_type.toLowerCase() !== "bearer"
    ) {
      throw new OAuthError("OAuth token response must use Bearer tokens");
    }
    if (
      typeof payload.expires_in !== "number" ||
      !Number.isFinite(payload.expires_in) ||
      payload.expires_in <= 0
    ) {
      throw new OAuthError("OAuth token response omitted a valid expires_in");
    }

    return {
      accessToken: payload.access_token,
      expiresAt: this.now() + payload.expires_in * 1000,
      ...(typeof payload.refresh_token === "string"
        ? { refreshToken: payload.refresh_token }
        : {}),
      ...(typeof payload.scope === "string" ? { scope: payload.scope } : {}),
      ...(typeof payload.id_token === "string"
        ? { idToken: payload.id_token }
        : {}),
      tokenType: "Bearer",
    };
  }

  private async fetchJson(url: URL): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
    });
    if (!response.ok) {
      throw new OAuthError(
        `OIDC discovery failed with status ${response.status}`,
        response.status,
      );
    }
    try {
      const payload = await response.json();
      if (!payload || typeof payload !== "object") {
        throw new Error("not an object");
      }
      return payload as Record<string, unknown>;
    } catch {
      throw new OAuthError("OIDC discovery response was not valid JSON");
    }
  }

  private requireClientId(): string {
    if (!this.auth.clientId) {
      throw new OAuthError("OAuth clientId is missing");
    }
    return this.auth.clientId;
  }

  private openBrowser(url: string): void {
    const platform = os.platform();
    const command =
      platform === "darwin"
        ? "open"
        : platform === "win32"
          ? "rundll32.exe"
          : "xdg-open";
    const args =
      platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];

    execFile(command, args, () => {
      // Do not log the authorization URL because it contains a live state value.
    });
  }
}

function currentRedirectUri(
  server: ReturnType<typeof createServer>,
  path: string,
): string {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new OAuthError("Local OAuth server did not expose a port");
  }
  return `http://127.0.0.1:${(address as AddressInfo).port}${path}`;
}

function randomBase64Url(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function normalizeUrl(value: string): string {
  return value.replace(/\/$/, "");
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function validateEndpoint(value: string, allowLoopbackHttp: boolean): URL {
  const url = new URL(value);
  const isAllowedHttp =
    allowLoopbackHttp && url.protocol === "http:" && isLoopback(url.hostname);
  if (url.protocol !== "https:" && !isAllowedHttp) {
    throw new OAuthError("OAuth provider endpoints must use HTTPS");
  }
  if (url.username || url.password || url.hash) {
    throw new OAuthError(
      "OAuth provider endpoints cannot contain credentials or fragments",
    );
  }
  return url;
}
