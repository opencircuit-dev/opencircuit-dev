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
});
