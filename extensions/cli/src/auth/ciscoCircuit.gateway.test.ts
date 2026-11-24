import type { AuthOptions } from "@opencircuit/config-types";
import * as adapters from "@opencircuit/openai-adapters";
import { describe, expect, it, vi } from "vitest";

import { CiscoCircuitGateway } from "./ciscoCircuit.js";

function createAuth(): AuthOptions {
  return {
    enabled: true,
    profile: "cisco-circuit",
    issuer: "https://identity.cisco.example/oidc",
    clientId: "public-client",
    scopes: ["openid", "offline_access"],
    gatewayBase: "https://organon.cisco.com/vscode-plugin",
    modelPolicyPath: "/api/model-policy",
    modelApiVersion: "2026-01-01",
    redirectPort: 0,
    redirectPath: "/oauth/callback",
  };
}

describe("CiscoCircuitGateway", () => {
  it("uses the shared gateway implementation", () => {
    expect(Reflect.get(adapters, "CiscoCircuitGateway")).toBe(
      CiscoCircuitGateway,
    );
  });

  it("normalizes Circuit policy and authenticates policy and deployment requests", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith("/api/model-policy")
        ? Response.json({
            models: [
              {
                model: "approved-model",
                name: "Approved",
                provider: "cisco",
                contextLength: 8192,
              },
            ],
            version: "1",
          })
        : Response.json({ id: "completion", choices: [] }),
    );
    const getAccessToken = vi.fn(async () => "delegated-token");
    const gateway = new CiscoCircuitGateway(getAccessToken, createAuth(), {
      fetch: fetchMock,
    });
    await expect(gateway.getPolicy()).resolves.toEqual({
      models: [{ id: "approved-model", name: "Approved" }],
    });
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://organon.cisco.com/vscode-plugin/api/model-policy",
    );
    expect(
      new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization"),
    ).toBe("Bearer delegated-token");

    const api = gateway.createLlmApi("approved-model");
    await api.chatCompletionNonStream(
      { messages: [{ role: "user", content: "hi" }], model: "approved-model" },
      new AbortController().signal,
    );
    const [url, request] = fetchMock.mock.calls[1];
    expect(String(url)).toBe(
      "https://organon.cisco.com/vscode-plugin/api/llm/openai/deployments/approved-model/chat/completions?api-version=2026-01-01",
    );
    expect(new Headers(request?.headers).get("Authorization")).toBe(
      "Bearer delegated-token",
    );
    expect(new Headers(request?.headers).has("api-key")).toBe(false);
  });

  it("rejects empty and duplicate policy model lists", async () => {
    const getAccessToken = vi.fn(async () => "delegated-token");
    for (const models of [[], ["same", { model: "same", provider: "cisco" }]]) {
      const gateway = new CiscoCircuitGateway(getAccessToken, createAuth(), {
        fetch: async () => Response.json({ models }),
      });
      await expect(gateway.getPolicy()).rejects.toThrow();
    }
  });

  it("keeps an explicitly unavailable policy model out of use", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({
        models: [
          { id: "mellum2-12b-thinking", available: false },
          { id: "gemma-4-31b-it" },
        ],
      }),
    );
    const gateway = new CiscoCircuitGateway(
      async () => "delegated-token",
      createAuth(),
      { fetch: fetchMock },
    );

    await gateway.getPolicy();
    await expect(
      gateway.createLlmApi("mellum2-12b-thinking").chatCompletionNonStream(
        {
          messages: [{ content: "hi", role: "user" }],
          model: "mellum2-12b-thinking",
        },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Cisco model is unavailable");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("routes an entitled model through its policy deployment", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith("/api/model-policy")
        ? Response.json({
            models: [{ id: "model-id", deployment: "deployment-id" }],
          })
        : Response.json({ id: "completion", choices: [] }),
    );
    const getAccessToken = vi.fn(async () => "delegated-token");
    const gateway = new CiscoCircuitGateway(getAccessToken, createAuth(), {
      fetch: fetchMock,
    });
    await gateway.getPolicy();
    await gateway
      .createLlmApi("model-id")
      .chatCompletionNonStream(
        { messages: [{ role: "user", content: "hi" }], model: "model-id" },
        new AbortController().signal,
      );
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      "/deployments/deployment-id/chat/completions?",
    );
  });

  it("coalesces policy reads and rejects an unentitled model", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ models: ["approved-model"] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const getAccessToken = vi.fn(async () => "delegated-token");
    const gateway = new CiscoCircuitGateway(getAccessToken, createAuth(), {
      fetch: fetchMock,
    });

    await expect(
      Promise.all([gateway.getPolicy(), gateway.getPolicy()]),
    ).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(getAccessToken).toHaveBeenCalledOnce();

    const api = gateway.createLlmApi("blocked-model");
    await expect(
      api.chatCompletionNonStream(
        { messages: [{ content: "hi", role: "user" }], model: "blocked-model" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Cisco model is not entitled");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not restore a cached policy after sign-out invalidates an in-flight read", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>(async () => {
      await gate;
      return Response.json({ models: ["approved-model"] });
    });
    const gateway = new CiscoCircuitGateway(
      async () => "delegated-token",
      createAuth(),
      {
        fetch: fetchMock,
      },
    );
    const pending = gateway.getPolicy();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    gateway.clearPolicyCache();
    release();
    await expect(pending).rejects.toThrow();
    await gateway.getPolicy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
