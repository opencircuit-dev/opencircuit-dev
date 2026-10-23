import type { AuthOptions } from "@opencircuit/config-types";
import type { OpenCircuitClient } from "@opencircuit/sdk";
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
  it("coalesces policy reads and rejects an unentitled model", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ models: ["approved-model"] }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const client = {
      getAccessToken: vi.fn(async () => "delegated-token"),
    } as unknown as OpenCircuitClient;
    const gateway = new CiscoCircuitGateway(client, createAuth(), {
      fetch: fetchMock,
    });

    await expect(
      Promise.all([gateway.getPolicy(), gateway.getPolicy()]),
    ).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(client.getAccessToken).toHaveBeenCalledOnce();

    const api = gateway.createLlmApi("blocked-model");
    await expect(
      api.chatCompletionNonStream(
        { messages: [{ content: "hi", role: "user" }], model: "blocked-model" },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Cisco model is not entitled");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
