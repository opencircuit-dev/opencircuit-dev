import { describe, expect, it, vi } from "vitest";

import { CiscoCircuitApi } from "./CiscoCircuit.js";

describe("CiscoCircuitApi", () => {
  it("sends only a delegated bearer to the approved chat route", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe(
        "https://organon.cisco.com/vscode-plugin/api/llm/openai/deployments/test-model/chat/completions?api-version=2026-01-01",
      );
      expect(request.headers.get("Authorization")).toBe(
        "Bearer delegated-token",
      );
      expect(request.headers.get("api-key")).toBeNull();
      expect(request.headers.get("x-api-key")).toBeNull();
      return new Response(
        JSON.stringify({
          choices: [
            { index: 0, message: { role: "assistant", content: "OK" } },
          ],
          id: "chatcmpl-test",
          model: "test-model",
          object: "chat.completion",
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    const api = new CiscoCircuitApi(
      "https://organon.cisco.com/vscode-plugin/api/llm/openai/deployments/test-model/",
      async () => "delegated-token",
      "2026-01-01",
      fetchMock,
    );

    await expect(
      api.chatCompletionNonStream(
        { messages: [{ content: "Hi", role: "user" }], model: "test-model" },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ choices: [{ message: { content: "OK" } }] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects gateway URLs outside the approved route", () => {
    expect(
      () =>
        new CiscoCircuitApi(
          "https://attacker.example/v1/",
          async () => "token",
          "2026-01-01",
        ),
    ).toThrow("Cisco Circuit gateway endpoint is not approved");
  });

  it.each([
    ["streaming", 1],
    ["streaming", 2],
    ["non-streaming", 1],
    ["non-streaming", 2],
  ] as const)(
    "cancels a %s request while token lookup %i is pending",
    async (mode, blockedCall) => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      const getToken = vi.fn(async () => {
        calls++;
        if (calls === blockedCall) await gate;
        return "synthetic-token";
      });
      const fetchMock = vi.fn<typeof fetch>();
      const api = new CiscoCircuitApi(
        "https://organon.cisco.com/vscode-plugin/api/llm/openai/deployments/test-model/",
        getToken,
        "2026-01-01",
        fetchMock,
      );
      const controller = new AbortController();
      const body = {
        messages: [{ content: "Hi", role: "user" as const }],
        model: "test-model",
      };
      const pending =
        mode === "streaming"
          ? api
              .chatCompletionStream(
                { ...body, stream: true },
                controller.signal,
              )
              .next()
          : api.chatCompletionNonStream(body, controller.signal);
      try {
        await vi.waitFor(() =>
          expect(getToken).toHaveBeenCalledTimes(blockedCall),
        );
        controller.abort();
        const outcome = await Promise.race([
          pending.then(
            () => "resolved",
            () => "cancelled",
          ),
          new Promise<string>((resolve) =>
            setTimeout(() => resolve("still waiting"), 100),
          ),
        ]);
        expect(outcome).toBe("cancelled");
      } finally {
        release();
        await pending.catch(() => undefined);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("observes cancellation triggered during the token lookup itself", async () => {
    const controller = new AbortController();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = new CiscoCircuitApi(
      "https://organon.cisco.com/vscode-plugin/api/llm/openai/deployments/test-model/",
      async () => {
        controller.abort();
        await gate;
        return "synthetic-token";
      },
      "2026-01-01",
    );
    const pending = api.chatCompletionNonStream(
      { messages: [{ content: "Hi", role: "user" }], model: "test-model" },
      controller.signal,
    );
    try {
      const outcome = await Promise.race([
        pending.then(
          () => "resolved",
          () => "cancelled",
        ),
        new Promise<string>((resolve) =>
          setTimeout(() => resolve("still waiting"), 100),
        ),
      ]);
      expect(outcome).toBe("cancelled");
    } finally {
      release();
      await pending.catch(() => undefined);
    }
  });
});
