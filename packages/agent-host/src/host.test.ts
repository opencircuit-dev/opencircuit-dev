import { describe, expect, it } from "vitest";

import { InMemorySessionBackend } from "./backend.js";
import { AgentHost } from "./host.js";

const session = "ahp-session:/11111111-1111-4111-8111-111111111111";

describe("AHP host lifecycle", () => {
  it("negotiates, lists and subscribes without a provider call", async () => {
    const host = new AgentHost({ backend: new InMemorySessionBackend() });
    const initialize = await host.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        channel: "ahp-root://",
        clientId: "test-client",
        protocolVersions: ["1.1.0", "1.0.0"],
      },
    });
    expect(initialize).toMatchObject({ result: { protocolVersion: "1.1.0" } });

    const created = await host.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "createSession",
      params: { channel: session, provider: "opencircuit" },
    });
    expect(created).toMatchObject([
      { jsonrpc: "2.0", id: 2, result: null },
      {
        jsonrpc: "2.0",
        method: "root/sessionAdded",
        params: { summary: { resource: session } },
      },
    ]);

    const listed = await host.handle({
      jsonrpc: "2.0",
      id: 3,
      method: "listSessions",
      params: { channel: "ahp-root://" },
    });
    expect(listed).toMatchObject({
      result: { items: [{ resource: session }] },
    });

    const subscribed = await host.handle({
      jsonrpc: "2.0",
      id: 4,
      method: "subscribe",
      params: { channel: session },
    });
    expect(subscribed).toMatchObject({
      result: {
        snapshot: { resource: session, state: { lifecycle: "ready" } },
      },
    });
  });

  it("rejects commands before initialize and malformed channels", async () => {
    const host = new AgentHost({ backend: new InMemorySessionBackend() });
    expect(
      await host.handle({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
        params: { channel: "ahp-root://" },
      }),
    ).toMatchObject({ error: { code: -32602 } });
    await host.handle({
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: {
        channel: "ahp-root://",
        clientId: "test-client",
        protocolVersions: ["1.0.0"],
      },
    });
    expect(
      await host.handle({
        jsonrpc: "2.0",
        id: 3,
        method: "createSession",
        params: { channel: "ahp-session:/bad" },
      }),
    ).toMatchObject({ error: { code: -32602 } });
  });

  it("returns the required unsupported-version error and closes", async () => {
    const host = new AgentHost({ backend: new InMemorySessionBackend() });
    const response = await host.handle({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        channel: "ahp-root://",
        clientId: "test-client",
        protocolVersions: ["9.0.0"],
      },
    });
    expect(response).toMatchObject({
      error: {
        code: -32005,
        data: { supportedVersions: ["1.1.0", "1.0.0", "0.9.0"] },
      },
    });
    expect(
      await host.handle({
        jsonrpc: "2.0",
        id: 2,
        method: "ping",
        params: { channel: "ahp-root://" },
      }),
    ).toBeNull();
  });
});
