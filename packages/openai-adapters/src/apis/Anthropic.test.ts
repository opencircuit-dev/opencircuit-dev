import { afterEach, describe, expect, it, vi } from "vitest";
import { Response } from "node-fetch";
import * as util from "../util.js";

import { CACHING_STRATEGIES } from "./AnthropicCachingStrategies.js";
import { addCacheControlToLastTwoUserMessages } from "./AnthropicUtils.js";
import { AnthropicApi } from "./Anthropic.js";

describe("AnthropicApi", () => {
  describe("model listing", () => {
    afterEach(() => vi.restoreAllMocks());

    it("paginates with the configured transport, endpoint and authentication", async () => {
      const fetch = vi.fn<ReturnType<typeof util.customFetch>>();
      fetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: [{ id: "claude-sonnet-4-6" }],
              has_more: true,
              last_id: "cursor/+",
            }),
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: [{ id: "claude-haiku-4-5" }],
              has_more: false,
            }),
          ),
        );
      const transport = vi.spyOn(util, "customFetch").mockReturnValue(fetch);
      const requestOptions = {
        timeout: 2000,
        headers: { "X-Test": "catalog" },
      };
      const api = new AnthropicApi({
        provider: "anthropic",
        apiKey: "fake-key",
        apiBase: "https://example.test/custom/v1",
        requestOptions,
      });
      expect((await api.list()).map((model) => model.id)).toEqual([
        "claude-sonnet-4-6",
        "claude-haiku-4-5",
      ]);
      expect(transport).toHaveBeenCalledWith(requestOptions);
      const [url, init] = fetch.mock.calls[1];
      expect(String(url)).toContain("https://example.test/custom/v1/models?");
      expect(new URL(String(url)).searchParams.get("after_id")).toBe(
        "cursor/+",
      );
      expect(init?.headers).toMatchObject({
        "x-api-key": "fake-key",
        "anthropic-version": "2023-06-01",
      });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it("rejects HTTP errors without exposing their response body", async () => {
      const fetch = vi
        .fn<ReturnType<typeof util.customFetch>>()
        .mockResolvedValue(new Response("fake-secret", { status: 401 }));
      vi.spyOn(util, "customFetch").mockReturnValue(fetch);
      await expect(
        new AnthropicApi({
          provider: "anthropic",
          apiKey: "fake-key",
        }).list(),
      ).rejects.toMatchObject({
        status: 401,
        message: "Anthropic model catalog request failed",
      });
    });

    it.each([
      { data: "invalid", has_more: false },
      {
        data: [{ id: "claude-sonnet-4-6" }],
        has_more: true,
        last_id: "repeat",
      },
    ])("rejects malformed catalogs and repeated pagination", async (page) => {
      const fetch = vi
        .fn<ReturnType<typeof util.customFetch>>()
        .mockImplementation(async () => new Response(JSON.stringify(page)));
      vi.spyOn(util, "customFetch").mockReturnValue(fetch);
      await expect(
        new AnthropicApi({
          provider: "anthropic",
          apiKey: "fake-key",
        }).list(),
      ).rejects.toThrow();
      expect(fetch.mock.calls.length).toBeLessThanOrEqual(2);
    });
  });

  describe("_convertBody applies cache_control to last two user messages", () => {
    const api = new AnthropicApi({
      provider: "anthropic",
      apiKey: "test-key",
      cachingStrategy: "systemAndTools",
    });

    it("adds cache_control to the last two user messages", () => {
      const body = api._convertToCleanAnthropicBody({
        model: "claude-sonnet-4-20250514",
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "First user message" },
          { role: "assistant", content: "First response" },
          { role: "user", content: "Second user message" },
          { role: "assistant", content: "Second response" },
          { role: "user", content: "Third user message" },
        ],
      });

      const result = CACHING_STRATEGIES["systemAndTools"](body);
      addCacheControlToLastTwoUserMessages(result.messages);

      // The last user message (index 4 = "Third user message") should have cache_control
      const lastUserMsg = result.messages[4];
      expect(lastUserMsg.role).toBe("user");
      expect(Array.isArray(lastUserMsg.content)).toBe(true);
      if (Array.isArray(lastUserMsg.content)) {
        const textPart = lastUserMsg.content.find(
          (p: any) => p.type === "text",
        );
        expect((textPart as any)?.cache_control).toEqual({ type: "ephemeral" });
      }

      // The second-to-last user message (index 2 = "Second user message") should also have cache_control
      const secondLastUserMsg = result.messages[2];
      expect(secondLastUserMsg.role).toBe("user");
      expect(Array.isArray(secondLastUserMsg.content)).toBe(true);
      if (Array.isArray(secondLastUserMsg.content)) {
        const textPart = secondLastUserMsg.content.find(
          (p: any) => p.type === "text",
        );
        expect((textPart as any)?.cache_control).toEqual({ type: "ephemeral" });
      }

      // The first user message (index 0 = "First user message") should NOT have cache_control
      const firstUserMsg = result.messages[0];
      expect(firstUserMsg.role).toBe("user");
      expect(Array.isArray(firstUserMsg.content)).toBe(true);
      if (Array.isArray(firstUserMsg.content)) {
        const textPart = firstUserMsg.content.find(
          (p: any) => p.type === "text",
        );
        expect((textPart as any)?.cache_control).toBeUndefined();
      }
    });

    it("handles conversations with only one user message", () => {
      const body = api._convertToCleanAnthropicBody({
        model: "claude-sonnet-4-20250514",
        messages: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Only user message" },
        ],
      });

      const result = CACHING_STRATEGIES["systemAndTools"](body);
      addCacheControlToLastTwoUserMessages(result.messages);

      const userMsg = result.messages[0];
      expect(userMsg.role).toBe("user");
      expect(Array.isArray(userMsg.content)).toBe(true);
      if (Array.isArray(userMsg.content)) {
        const textPart = userMsg.content.find((p: any) => p.type === "text");
        expect((textPart as any)?.cache_control).toEqual({ type: "ephemeral" });
      }
    });

    it("does not cache user messages when caching strategy is none", () => {
      const api = new AnthropicApi({
        provider: "anthropic",
        apiKey: "test-key",
        cachingStrategy: "none",
      });

      const result = (api as any)._convertBody({
        model: "claude-sonnet-4-20250514",
        messages: [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi" },
          { role: "user", content: "How are you?" },
        ],
      });

      // No cache_control should be added when strategy is "none"
      const lastUserMsg = result.messages[2];
      expect(lastUserMsg.role).toBe("user");
      if (Array.isArray(lastUserMsg.content)) {
        const textPart = lastUserMsg.content.find(
          (p: any) => p.type === "text",
        );
        expect((textPart as any)?.cache_control).toBeUndefined();
      }
    });
  });
});
