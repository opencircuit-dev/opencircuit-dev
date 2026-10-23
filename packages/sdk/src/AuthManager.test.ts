import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { exportJWK, generateKeyPair, type KeyLike, SignJWT } from "jose";

import type { ConfigJson } from "@opencircuit/config-types";
import { AuthManager, MemoryTokenStore, OAuthError } from "./AuthManager.js";

interface ProviderHarness {
  authorizationEndpoint: string;
  issuer: string;
  revocationEndpoint: string;
  revokeRequests: URLSearchParams[];
  setIdTokenFactory(factory: () => Promise<string>): void;
  tokenEndpoint: string;
  tokenRequests: URLSearchParams[];
  close(): Promise<void>;
}

const providers: ProviderHarness[] = [];

afterEach(async () => {
  await Promise.all(providers.splice(0).map((provider) => provider.close()));
});

describe("AuthManager", () => {
  it.each([undefined, "cisco-circuit"] as const)(
    "uses PKCE and a reachable matching callback for profile %s",
    async (profile) => {
      const provider = await createProvider();
      const browserUrls: string[] = [];
      const manager = new AuthManager(
        createConfig({
          ...(profile ? { profile } : {}),
          authorizationEndpoint: provider.authorizationEndpoint,
          revocationEndpoint: provider.revocationEndpoint,
          tokenEndpoint: provider.tokenEndpoint,
        }),
        { openBrowser: (url) => browserUrls.push(url) },
      );

      const authentication = manager.authenticate();
      const authorizationUrl = new URL(
        await waitForBrowserUrl(browserUrls, authentication),
      );
      const verifierChallenge =
        authorizationUrl.searchParams.get("code_challenge");
      const redirectUri = authorizationUrl.searchParams.get("redirect_uri");

      expect(authorizationUrl.searchParams.get("response_type")).toBe("code");
      expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe(
        "S256",
      );
      expect(authorizationUrl.searchParams.get("state")).toMatch(
        /^[A-Za-z0-9_-]{43}$/,
      );
      expect(authorizationUrl.searchParams.get("nonce")).toBeNull();
      expect(redirectUri).toMatch(
        profile
          ? /^http:\/\/localhost:\d+$/
          : /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/,
      );

      const callback = new URL(redirectUri!);
      callback.searchParams.set("code", "authorization-code");
      callback.searchParams.set(
        "state",
        authorizationUrl.searchParams.get("state")!,
      );
      await expect(fetch(callback)).resolves.toMatchObject({ status: 200 });

      const tokenSet = await authentication;
      const tokenRequest = provider.tokenRequests[0];
      const verifier = tokenRequest.get("code_verifier");

      expect(tokenSet?.accessToken).toBe("access-token");
      expect(tokenRequest.get("grant_type")).toBe("authorization_code");
      expect(tokenRequest.get("code")).toBe("authorization-code");
      expect(tokenRequest.get("redirect_uri")).toBe(redirectUri);
      expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(verifierChallenge).toBe(
        createHash("sha256").update(verifier!).digest("base64url"),
      );
    },
  );

  it.each([undefined, "cisco-circuit"] as const)(
    "rejects mismatched state for profile %s before token exchange",
    async (profile) => {
      const provider = await createProvider();
      const browserUrls: string[] = [];
      const manager = new AuthManager(
        createConfig({
          ...(profile ? { profile } : {}),
          authorizationEndpoint: provider.authorizationEndpoint,
          tokenEndpoint: provider.tokenEndpoint,
        }),
        { openBrowser: (url) => browserUrls.push(url) },
      );

      const authentication = manager.authenticate();
      const authorizationUrl = new URL(
        await waitForBrowserUrl(browserUrls, authentication),
      );
      const callback = new URL(
        authorizationUrl.searchParams.get("redirect_uri")!,
      );
      callback.searchParams.set("code", "attacker-code");
      callback.searchParams.set("state", "wrong-state");

      await expect(fetch(callback)).resolves.toMatchObject({ status: 400 });
      await expect(authentication).rejects.toMatchObject({
        constructor: OAuthError,
        message: "OAuth state validation failed",
      });
      expect(provider.tokenRequests).toHaveLength(0);
    },
  );

  it("does not accept an OAuth error callback without a valid state", async () => {
    const provider = await createProvider();
    const browserUrls: string[] = [];
    const manager = new AuthManager(
      createConfig({
        authorizationEndpoint: provider.authorizationEndpoint,
        tokenEndpoint: provider.tokenEndpoint,
      }),
      { openBrowser: (url) => browserUrls.push(url) },
    );

    const authentication = manager.authenticate();
    const authorizationUrl = new URL(
      await waitForBrowserUrl(browserUrls, authentication),
    );
    const callback = new URL(
      authorizationUrl.searchParams.get("redirect_uri")!,
    );
    callback.searchParams.set("error", "access_denied");

    await expect(fetch(callback)).resolves.toMatchObject({ status: 400 });
    await expect(authentication).rejects.toMatchObject({
      constructor: OAuthError,
      message: "OAuth state validation failed",
    });
    expect(provider.tokenRequests).toHaveLength(0);
  });

  it("refreshes expired tokens and clears local state on revocation", async () => {
    const provider = await createProvider();
    const browserUrls: string[] = [];
    let now = 1_000_000;
    const manager = new AuthManager(
      createConfig({
        authorizationEndpoint: provider.authorizationEndpoint,
        revocationEndpoint: provider.revocationEndpoint,
        tokenEndpoint: provider.tokenEndpoint,
      }),
      {
        now: () => now,
        openBrowser: (url) => browserUrls.push(url),
      },
    );

    const authentication = manager.authenticate();
    const authorizationUrl = new URL(
      await waitForBrowserUrl(browserUrls, authentication),
    );
    const callback = new URL(
      authorizationUrl.searchParams.get("redirect_uri")!,
    );
    callback.searchParams.set("code", "authorization-code");
    callback.searchParams.set(
      "state",
      authorizationUrl.searchParams.get("state")!,
    );
    await fetch(callback);
    const initial = await authentication;

    now = initial!.expiresAt;
    await expect(manager.getAccessToken()).resolves.toBe(
      "refreshed-access-token",
    );
    expect(provider.tokenRequests[1].get("grant_type")).toBe("refresh_token");

    await expect(manager.revoke()).resolves.toBe(true);
    expect(provider.revokeRequests[0].get("token")).toBe(
      "refreshed-access-token",
    );
    await expect(manager.getAccessToken()).resolves.toBeNull();
  });

  it("coalesces concurrent refreshes and preserves the rotated token", async () => {
    const provider = await createProvider();
    const store = new MemoryTokenStore();
    await store.save({
      accessToken: "expired-access-token",
      expiresAt: 1,
      refreshToken: "refresh-token",
      tokenType: "Bearer",
    });
    const manager = new AuthManager(
      createConfig({
        authorizationEndpoint: provider.authorizationEndpoint,
        tokenEndpoint: provider.tokenEndpoint,
      }),
      { now: () => 2_000, tokenStore: store },
    );

    await expect(
      Promise.all([manager.getAccessToken(), manager.getAccessToken()]),
    ).resolves.toEqual(["refreshed-access-token", "refreshed-access-token"]);
    expect(provider.tokenRequests).toHaveLength(1);
    expect((await store.load())?.refreshToken).toBe("refresh-token");
  });

  it("validates the OIDC issuer, JWKS signature, audience, and nonce", async () => {
    const keyPair = await generateKeyPair("RS256");
    const provider = await createProvider(keyPair);
    const browserUrls: string[] = [];
    let requestedNonce: string | undefined;
    provider.setIdTokenFactory(async () =>
      new SignJWT({ nonce: requestedNonce })
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(provider.issuer)
        .setAudience("test-client")
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(keyPair.privateKey),
    );
    const manager = new AuthManager(createConfig({ issuer: provider.issuer }), {
      openBrowser: (url) => {
        const authorizationUrl = new URL(url);
        requestedNonce =
          authorizationUrl.searchParams.get("nonce") ?? undefined;
        browserUrls.push(url);
      },
    });

    const authentication = manager.authenticate();
    const authorizationUrl = new URL(
      await waitForBrowserUrl(browserUrls, authentication),
    );
    const callback = new URL(
      authorizationUrl.searchParams.get("redirect_uri")!,
    );
    callback.searchParams.set("code", "authorization-code");
    callback.searchParams.set(
      "state",
      authorizationUrl.searchParams.get("state")!,
    );
    await fetch(callback);

    await expect(authentication).resolves.toMatchObject({
      accessToken: "access-token",
      idToken: expect.any(String),
    });
  });
});

function createConfig(auth: Record<string, unknown>): ConfigJson {
  return {
    auth: {
      clientId: "test-client",
      enabled: true,
      ...auth,
    },
  } as ConfigJson;
}

async function createProvider(signingKeyPair?: {
  privateKey: KeyLike;
  publicKey: KeyLike;
}): Promise<ProviderHarness> {
  const keyPair = signingKeyPair ?? (await generateKeyPair("RS256"));
  const publicJwk = await exportJWK(keyPair.publicKey);
  const tokenRequests: URLSearchParams[] = [];
  const revokeRequests: URLSearchParams[] = [];
  let idTokenFactory: (() => Promise<string>) | undefined;
  let issuer = "";

  const server = createServer(async (request, response) => {
    if (request.url === "/.well-known/openid-configuration") {
      return sendJson(response, {
        authorization_endpoint: `${issuer}/oauth/authorize`,
        issuer,
        jwks_uri: `${issuer}/oauth/jwks`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
        token_endpoint: `${issuer}/oauth/token`,
      });
    }
    if (request.url === "/oauth/jwks") {
      return sendJson(response, {
        keys: [{ ...publicJwk, kid: "test-key", alg: "RS256" }],
      });
    }
    if (request.url === "/oauth/token" && request.method === "POST") {
      const body = new URLSearchParams(await readBody(request));
      tokenRequests.push(body);
      const idToken = idTokenFactory ? await idTokenFactory() : undefined;
      return sendJson(response, {
        access_token:
          body.get("grant_type") === "refresh_token"
            ? "refreshed-access-token"
            : "access-token",
        expires_in: 3_600,
        ...(idToken ? { id_token: idToken } : {}),
        refresh_token: "refresh-token",
        token_type: "Bearer",
      });
    }
    if (request.url === "/oauth/revoke" && request.method === "POST") {
      revokeRequests.push(new URLSearchParams(await readBody(request)));
      response.writeHead(200);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  issuer = `http://127.0.0.1:${address.port}`;
  const harness: ProviderHarness = {
    authorizationEndpoint: `${issuer}/oauth/authorize`,
    issuer,
    revocationEndpoint: `${issuer}/oauth/revoke`,
    revokeRequests,
    setIdTokenFactory(factory) {
      idTokenFactory = factory;
    },
    tokenEndpoint: `${issuer}/oauth/token`,
    tokenRequests,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
  providers.push(harness);
  return harness;
}

async function readBody(request: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(
  response: import("node:http").ServerResponse,
  payload: unknown,
): void {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function waitFor<T>(getValue: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const value = getValue();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for OAuth browser launch");
}

async function waitForBrowserUrl(
  browserUrls: string[],
  authentication: Promise<unknown>,
): Promise<string> {
  let authenticationError: unknown;
  void authentication.catch((error) => {
    authenticationError = error;
  });
  return waitFor(() => {
    if (authenticationError) throw authenticationError;
    return browserUrls[0];
  });
}
