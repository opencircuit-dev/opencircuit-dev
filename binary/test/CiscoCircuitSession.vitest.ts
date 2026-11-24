import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configureAuth: vi.fn(),
  getAccessToken: vi.fn(),
  authenticate: vi.fn(),
  logout: vi.fn(),
  createOAuthTokenStore: vi.fn(() => ({})),
  resolveAuth: vi.fn((auth) => auth),
  clearPolicyCache: vi.fn(),
  getPolicy: vi.fn(),
  createLlmApi: vi.fn(),
}));

vi.mock("@opencircuit/sdk", () => ({
  TokenStoreUnavailable: class extends Error {},
  OpenCircuitClient: class {
    configureAuth = mocks.configureAuth;
    getAccessToken = mocks.getAccessToken;
    authenticate = mocks.authenticate;
    logout = mocks.logout;
  },
  createOAuthTokenStore: mocks.createOAuthTokenStore,
}));

vi.mock("@opencircuit/openai-adapters", () => ({
  resolveCiscoCircuitAuth: mocks.resolveAuth,
  CiscoCircuitGateway: class {
    constructor(readonly accessToken: () => Promise<string | null>) {}
    clearPolicyCache = mocks.clearPolicyCache;
    getPolicy = mocks.getPolicy;
    createLlmApi = mocks.createLlmApi;
  },
}));

import { CiscoCircuitSession } from "../src/CiscoCircuitSession";
import { TokenStoreUnavailable } from "@opencircuit/sdk";

const auth = {
  enabled: true,
  profile: "cisco-circuit" as const,
  issuer: "https://issuer.example",
  clientId: "test-client",
};

describe("Cisco native authentication session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses the CLI's secure store without returning credentials", async () => {
    mocks.getAccessToken.mockResolvedValue("synthetic-access-token");
    const session = new CiscoCircuitSession(auth, "/test/profile");
    await session.ensureAuthenticated(false);
    expect(mocks.createOAuthTokenStore).toHaveBeenCalledWith(auth);
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.getAccessToken).toHaveBeenCalled();
  });

  it("requires explicit interactive sign-in when no credentials exist", async () => {
    mocks.getAccessToken.mockResolvedValue(null);
    const session = new CiscoCircuitSession(auth, "/test/profile");
    await expect(session.ensureAuthenticated(false)).rejects.toMatchObject({
      code: "CISCO_AUTH_REQUIRED",
      message: "Cisco Circuit sign-in is required",
    });
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it("starts sign-in only when explicitly requested and verifies the result", async () => {
    mocks.getAccessToken
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("synthetic-access-token");
    const session = new CiscoCircuitSession(auth, "/test/profile");
    await session.ensureAuthenticated(true);
    expect(mocks.authenticate).toHaveBeenCalledOnce();
    expect(mocks.getAccessToken).toHaveBeenCalledTimes(2);
  });

  it("does not suppress credential-store failures", async () => {
    mocks.getAccessToken.mockRejectedValue(
      new TokenStoreUnavailable("credential store unavailable"),
    );
    const session = new CiscoCircuitSession(auth, "/test/profile");
    await expect(session.ensureAuthenticated(false)).rejects.toThrow(
      "credential store unavailable",
    );
    expect(mocks.authenticate).not.toHaveBeenCalled();
  });

  it("reports failed token refresh as an authentication failure", async () => {
    mocks.getAccessToken.mockRejectedValue(new Error("private OAuth response"));
    const session = new CiscoCircuitSession(auth, "/test/profile");
    await expect(session.ensureAuthenticated(false)).rejects.toMatchObject({
      code: "CISCO_AUTH_FAILED",
      message: "Cisco Circuit authentication failed",
    });
  });

  it("allows explicit sign-in after an expired session fails to refresh", async () => {
    mocks.getAccessToken
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockResolvedValueOnce("synthetic-access-token");
    const session = new CiscoCircuitSession(auth, "/test/profile");
    await session.ensureAuthenticated(true);
    expect(mocks.authenticate).toHaveBeenCalledOnce();
  });

  it("clears cached policy on sign-out even if revocation fails", async () => {
    mocks.logout.mockImplementation(async () => {
      expect(mocks.clearPolicyCache).toHaveBeenCalledOnce();
      throw new Error("revocation failed");
    });
    const session = new CiscoCircuitSession(auth, "/test/profile");
    await expect(session.logout()).rejects.toThrow("revocation failed");
    expect(mocks.clearPolicyCache).toHaveBeenCalledTimes(2);
  });

  it("waits for an in-flight token refresh before signing out", async () => {
    let release!: (token: string) => void;
    mocks.getAccessToken.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        release = resolve;
      }),
    );
    mocks.logout.mockResolvedValue(true);
    const session = new CiscoCircuitSession(auth, "/test/profile");
    const refresh = session.ensureAuthenticated(false);
    const logout = session.logout();
    expect(mocks.logout).not.toHaveBeenCalled();
    await expect(session.ensureAuthenticated(false)).rejects.toMatchObject({
      code: "CISCO_AUTH_REQUIRED",
    });
    release("synthetic-access-token");
    await refresh;
    await logout;
    expect(mocks.logout).toHaveBeenCalledOnce();
  });

  it("waits for interactive sign-in before clearing credentials", async () => {
    let release!: () => void;
    mocks.getAccessToken.mockResolvedValue(null);
    mocks.authenticate.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    mocks.logout.mockResolvedValue(true);
    const session = new CiscoCircuitSession(auth, "/test/profile");
    const login = session.ensureAuthenticated(true);
    await vi.waitFor(() => expect(mocks.authenticate).toHaveBeenCalledOnce());
    const logout = session.logout();
    expect(mocks.logout).not.toHaveBeenCalled();
    release();
    await expect(login).rejects.toMatchObject({ code: "CISCO_AUTH_REQUIRED" });
    await logout;
    expect(mocks.logout).toHaveBeenCalledOnce();
  });

  it("reads a linked Cisco config without changing the CLI file", async () => {
    const root = await mkdtemp(join(tmpdir(), "oc-native-config-"));
    try {
      const target = join(root, "cli.yaml");
      const link = join(root, "config.yaml");
      const text = "auth:\n  enabled: true\n  profile: cisco-circuit\n";
      await writeFile(target, text, { mode: 0o600 });
      await symlink(target, link);
      expect(
        await CiscoCircuitSession.fromConfig(link, "/test/profile"),
      ).toBeInstanceOf(CiscoCircuitSession);
      expect(await readFile(target, "utf8")).toBe(text);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not enable Cisco authentication for unrelated configurations", async () => {
    const root = await mkdtemp(join(tmpdir(), "oc-native-config-"));
    try {
      const config = join(root, "config.yaml");
      await writeFile(config, "name: example\n");
      expect(
        await CiscoCircuitSession.fromConfig(config, "/test/profile"),
      ).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not silently treat an inaccessible config as disabled authentication", async () => {
    const root = await mkdtemp(join(tmpdir(), "oc-native-config-"));
    try {
      const link = join(root, "config.yaml");
      await symlink(join(root, "missing.yaml"), link);
      await expect(
        CiscoCircuitSession.fromConfig(link, "/test/profile"),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses an empty linked config before Core can write defaults through it", async () => {
    const root = await mkdtemp(join(tmpdir(), "oc-native-config-"));
    try {
      const target = join(root, "cli.yaml");
      const link = join(root, "config.yaml");
      await writeFile(target, "", { mode: 0o600 });
      await symlink(target, link);
      await expect(
        CiscoCircuitSession.fromConfig(link, "/test/profile"),
      ).rejects.toThrow();
      expect(await readFile(target, "utf8")).toBe("");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("lists only available policy models and routes the selected session model", async () => {
    mocks.getAccessToken.mockResolvedValue("synthetic-access-token");
    mocks.getPolicy.mockResolvedValue({
      models: [
        { id: "first", name: "First" },
        { id: "second", name: "Second" },
        { id: "unavailable", available: false },
      ],
    });
    const stream = vi.fn(async function* () {
      yield { choices: [{ delta: { content: "response" } }] };
    });
    mocks.createLlmApi.mockReturnValue({ chatCompletionStream: stream });
    const session = new CiscoCircuitSession(auth, "/test/profile");

    expect(await session.listModels()).toEqual([
      { id: "first", name: "First" },
      { id: "second", name: "Second" },
    ]);
    const messages = [{ role: "user" as const, content: "hello" }];
    const signal = new AbortController().signal;
    const collect = async (model: string) => {
      const result = [];
      for await (const chunk of session.streamChat(model, messages, signal)) {
        result.push(chunk);
      }
      return result;
    };
    expect(await Promise.all([collect("first"), collect("second")])).toEqual([
      [{ role: "assistant", content: "response" }],
      [{ role: "assistant", content: "response" }],
    ]);
    expect(mocks.createLlmApi.mock.calls.map(([model]) => model)).toEqual([
      "first",
      "second",
    ]);
    await expect(collect("unavailable")).rejects.toMatchObject({
      code: "CISCO_MODEL_UNAVAILABLE",
    });
    await expect(collect("unknown")).rejects.toMatchObject({
      code: "CISCO_MODEL_UNAVAILABLE",
    });
    expect(mocks.createLlmApi).toHaveBeenCalledTimes(2);
  });

  it("reports policy failures without exposing provider details", async () => {
    mocks.getAccessToken.mockResolvedValue("synthetic-access-token");
    mocks.getPolicy.mockRejectedValue(new Error("private provider details"));
    const session = new CiscoCircuitSession(auth, "/test/profile");
    await expect(session.listModels()).rejects.toMatchObject({
      code: "CISCO_POLICY_FAILED",
      message: "Cisco Circuit model policy could not be loaded",
    });
  });

  it("uses the non-streaming gateway for an explicitly non-streaming turn", async () => {
    mocks.getAccessToken.mockResolvedValue("synthetic-access-token");
    mocks.getPolicy.mockResolvedValue({ models: [{ id: "first" }] });
    const complete = vi.fn(async () => ({
      choices: [{ message: { role: "assistant", content: "complete answer" } }],
    }));
    const stream = vi.fn();
    mocks.createLlmApi.mockReturnValue({
      chatCompletionNonStream: complete,
      chatCompletionStream: stream,
    });
    const signal = new AbortController().signal;
    const result = [];
    for await (const chunk of new CiscoCircuitSession(
      auth,
      "/test/profile",
    ).streamChat(
      "first",
      [{ role: "user", content: "hello" }],
      signal,
      false,
    )) {
      result.push(chunk);
    }
    expect(result).toEqual([{ role: "assistant", content: "complete answer" }]);
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ model: "first", stream: false }),
      signal,
    );
    expect(stream).not.toHaveBeenCalled();
  });

  it("rejects a non-streaming response that requires unsupported tools", async () => {
    mocks.getAccessToken.mockResolvedValue("synthetic-access-token");
    mocks.getPolicy.mockResolvedValue({ models: [{ id: "first" }] });
    mocks.createLlmApi.mockReturnValue({
      chatCompletionNonStream: async () => ({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "unsupported" }],
            },
          },
        ],
      }),
    });
    const iterator = new CiscoCircuitSession(auth, "/test/profile").streamChat(
      "first",
      [{ role: "user", content: "hello" }],
      new AbortController().signal,
      false,
    );
    await expect(iterator.next()).rejects.toThrow(
      "Unsupported Cisco completion response",
    );
  });

  it("cancels a pending non-streaming completion", async () => {
    mocks.getAccessToken.mockResolvedValue("synthetic-access-token");
    mocks.getPolicy.mockResolvedValue({ models: [{ id: "first" }] });
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const complete = vi.fn(async () => {
      await waiting;
      return {
        choices: [{ message: { role: "assistant", content: "late" } }],
      };
    });
    mocks.createLlmApi.mockReturnValue({ chatCompletionNonStream: complete });
    const controller = new AbortController();
    const iterator = new CiscoCircuitSession(auth, "/test/profile").streamChat(
      "first",
      [{ role: "user", content: "hello" }],
      controller.signal,
      false,
    );
    const next = iterator.next();
    try {
      await vi.waitFor(() => expect(complete).toHaveBeenCalledOnce());
      controller.abort();
      await expect(next).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      release();
    }
  });

  it("does not start authentication or policy requests for a cancelled turn", async () => {
    const session = new CiscoCircuitSession(auth, "/test/profile");
    const controller = new AbortController();
    controller.abort();
    const iterator = session.streamChat(
      "first",
      [{ role: "user", content: "hello" }],
      controller.signal,
    );
    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
    expect(mocks.getAccessToken).not.toHaveBeenCalled();
    expect(mocks.getPolicy).not.toHaveBeenCalled();
  });

  it("propagates cancellation to an active gateway stream", async () => {
    mocks.getAccessToken.mockResolvedValue("synthetic-access-token");
    mocks.getPolicy.mockResolvedValue({ models: [{ id: "first" }] });
    const stream = vi.fn(async function* (_body, signal: AbortSignal) {
      yield { choices: [{ delta: { content: "partial" } }] };
      signal.throwIfAborted();
    });
    mocks.createLlmApi.mockReturnValue({ chatCompletionStream: stream });
    const controller = new AbortController();
    const iterator = new CiscoCircuitSession(auth, "/test/profile").streamChat(
      "first",
      [{ role: "user", content: "hello" }],
      controller.signal,
    );
    expect(await iterator.next()).toMatchObject({
      value: { role: "assistant", content: "partial" },
    });
    expect(stream.mock.calls[0][1]).toBe(controller.signal);
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
  });

  it.each(["credentials", "policy"] as const)(
    "stops waiting for %s when a turn is cancelled",
    async (stage) => {
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        release = resolve;
      });
      mocks.getAccessToken.mockImplementation(async () => {
        if (stage === "credentials") await waiting;
        return "synthetic-access-token";
      });
      mocks.getPolicy.mockImplementation(async () => {
        if (stage === "policy") await waiting;
        return { models: [{ id: "first" }] };
      });
      const session = new CiscoCircuitSession(auth, "/test/profile");
      const controller = new AbortController();
      const iterator = session.streamChat(
        "first",
        [{ role: "user", content: "hello" }],
        controller.signal,
      );
      const next = iterator.next();
      try {
        await vi.waitFor(() =>
          expect(
            stage === "credentials" ? mocks.getAccessToken : mocks.getPolicy,
          ).toHaveBeenCalled(),
        );
        controller.abort();
        const outcome = await Promise.race([
          next.then(
            () => "resolved",
            (error: Error) => error.name,
          ),
          new Promise<string>((resolve) =>
            setTimeout(() => resolve("still waiting"), 100),
          ),
        ]);
        expect(outcome).toBe("AbortError");
        expect(mocks.createLlmApi).not.toHaveBeenCalled();
      } finally {
        release();
        await next.catch(() => undefined);
      }
    },
  );

  it("observes cancellation triggered while credential lookup starts", async () => {
    const controller = new AbortController();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    mocks.getAccessToken.mockImplementation(async () => {
      controller.abort();
      await waiting;
      return "synthetic-access-token";
    });
    const iterator = new CiscoCircuitSession(auth, "/test/profile").streamChat(
      "first",
      [{ role: "user", content: "hello" }],
      controller.signal,
    );
    const next = iterator.next();
    try {
      const outcome = await Promise.race([
        next.then(
          () => "resolved",
          (error: Error) => error.name,
        ),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("still waiting"), 100),
        ),
      ]);
      expect(outcome).toBe("AbortError");
    } finally {
      release();
      await next.catch(() => undefined);
    }
    expect(mocks.getPolicy).not.toHaveBeenCalled();
  });
});
