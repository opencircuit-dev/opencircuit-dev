import { afterEach, describe, expect, it, vi } from "vitest";
import { Response } from "node-fetch";
import * as util from "../util.js";

import { GeminiApi } from "./Gemini.js";

describe("GeminiApi", () => {
  describe("model listing", () => {
    afterEach(() => vi.restoreAllMocks());

    it("paginates and filters generation capabilities using the configured endpoint", async () => {
      const fetch = vi.fn<ReturnType<typeof util.customFetch>>();
      fetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              models: [
                {
                  name: "models/gemini-3.8-flash",
                  supportedGenerationMethods: ["generateContent"],
                },
                {
                  name: "models/gemini-embedding-001",
                  supportedGenerationMethods: ["embedContent"],
                },
              ],
              nextPageToken: "cursor/+",
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              models: [
                {
                  name: "models/gemini-3.1-pro-preview",
                  supportedGenerationMethods: ["generateContent"],
                },
              ],
            }),
          ),
        );
      const transport = vi.spyOn(util, "customFetch").mockReturnValue(fetch);
      const requestOptions = {
        timeout: 2000,
        headers: { "X-Test": "catalog" },
      };
      const api = new GeminiApi({
        provider: "gemini",
        apiKey: "fake-key",
        apiBase: "https://example.test/custom/v1beta",
        requestOptions,
      });
      expect((await api.list()).map((model) => model.id)).toEqual([
        "gemini-3.8-flash",
        "gemini-3.1-pro-preview",
      ]);
      expect(transport).toHaveBeenCalledWith(requestOptions);
      const [url, init] = fetch.mock.calls[1];
      expect(String(url)).toContain(
        "https://example.test/custom/v1beta/models?",
      );
      expect(new URL(String(url)).searchParams.get("pageToken")).toBe(
        "cursor/+",
      );
      expect(new URL(String(url)).searchParams.has("key")).toBe(false);
      expect(init?.headers).toMatchObject({ "x-goog-api-key": "fake-key" });
    });

    it("rejects HTTP errors without exposing their response body", async () => {
      const fetch = vi
        .fn<ReturnType<typeof util.customFetch>>()
        .mockResolvedValue(new Response("fake-secret", { status: 403 }));
      vi.spyOn(util, "customFetch").mockReturnValue(fetch);
      await expect(
        new GeminiApi({
          provider: "gemini",
          apiKey: "fake-key",
        }).list(),
      ).rejects.toMatchObject({
        status: 403,
        message: "Gemini model catalog request failed",
      });
    });

    it.each([{ models: "invalid" }, { models: [], nextPageToken: "repeat" }])(
      "rejects malformed catalogs and repeated pagination",
      async (page) => {
        const fetch = vi
          .fn<ReturnType<typeof util.customFetch>>()
          .mockImplementation(async () => new Response(JSON.stringify(page)));
        vi.spyOn(util, "customFetch").mockReturnValue(fetch);
        await expect(
          new GeminiApi({
            provider: "gemini",
            apiKey: "fake-key",
          }).list(),
        ).rejects.toThrow();
        expect(fetch.mock.calls.length).toBeLessThanOrEqual(2);
      },
    );
  });

  const api = new GeminiApi({
    provider: "gemini",
    apiKey: "test-key",
  });

  describe("_convertBody merges consecutive same-role messages", () => {
    it("merges consecutive tool responses into a single user turn", () => {
      const result = api._convertBody(
        {
          model: "gemini-2.5-flash",
          messages: [
            { role: "user", content: "Use the tools" },
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function" as const,
                  function: { name: "tool_a", arguments: "{}" },
                },
                {
                  id: "call_2",
                  type: "function" as const,
                  function: { name: "tool_b", arguments: "{}" },
                },
              ],
            },
            {
              role: "tool" as const,
              content: "result_a",
              tool_call_id: "call_1",
            },
            {
              role: "tool" as const,
              content: "result_b",
              tool_call_id: "call_2",
            },
          ],
        },
        false,
        true,
      );

      // Should be: user, model(functionCalls), user(functionResponses merged)
      expect(result.contents).toHaveLength(3);
      expect(result.contents[0].role).toBe("user");
      expect(result.contents[1].role).toBe("model");
      expect(result.contents[2].role).toBe("user");
      // Both function responses merged into one user turn
      expect(result.contents[2].parts).toHaveLength(2);
      expect(result.contents[2].parts[0]).toHaveProperty("functionResponse");
      expect(result.contents[2].parts[1]).toHaveProperty("functionResponse");
    });

    it("merges tool responses with following user message", () => {
      const result = api._convertBody(
        {
          model: "gemini-2.5-flash",
          messages: [
            { role: "user", content: "Use the tool" },
            {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function" as const,
                  function: { name: "tool_a", arguments: "{}" },
                },
              ],
            },
            {
              role: "tool" as const,
              content: "result_a",
              tool_call_id: "call_1",
            },
            { role: "user", content: "Now do something else" },
          ],
        },
        false,
        true,
      );

      // tool response (user) + user message should merge
      expect(result.contents).toHaveLength(3);
      expect(result.contents[2].role).toBe("user");
      expect(result.contents[2].parts).toHaveLength(2);
    });

    it("merges consecutive model messages", () => {
      const result = api._convertBody(
        {
          model: "gemini-2.5-flash",
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "First response" },
            { role: "assistant", content: "Second response" },
          ],
        },
        false,
        true,
      );

      // Two assistant messages should merge into one model message
      expect(result.contents).toHaveLength(2);
      expect(result.contents[1].role).toBe("model");
      expect(result.contents[1].parts).toHaveLength(2);
    });

    it("preserves already-alternating messages unchanged", () => {
      const result = api._convertBody(
        {
          model: "gemini-2.5-flash",
          messages: [
            { role: "user", content: "Hello" },
            { role: "assistant", content: "Hi there" },
            { role: "user", content: "How are you?" },
          ],
        },
        false,
        true,
      );

      expect(result.contents).toHaveLength(3);
      expect(result.contents[0].role).toBe("user");
      expect(result.contents[1].role).toBe("model");
      expect(result.contents[2].role).toBe("user");
    });
  });
});
