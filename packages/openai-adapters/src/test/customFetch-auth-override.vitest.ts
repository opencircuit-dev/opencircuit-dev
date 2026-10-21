import { createServer, type IncomingHttpHeaders } from "node:http";
import { describe, expect, it } from "vitest";
import { OpenAIApi } from "../apis/OpenAI.js";
import { customFetch } from "../util.js";

/**
 * Tests for the letRequestOptionsOverrideAuthHeaders function in customFetch
 *
 * The wrapper removes SDK auth headers when custom auth headers are configured
 * in requestOptions.headers.
 *
 * The logic being tested:
 * 1. If requestOptions.headers contains Authorization, api-key, or x-api-key
 * 2. Remove conflicting auth headers from init.headers (sent by OpenAI SDK)
 * 3. Let fetchwithRequestOptions merge in the custom headers
 * 4. Results in single, correct header (not duplicate)
 */
describe("customFetch - auth header override logic", () => {
  it("should export customFetch function", () => {
    expect(typeof customFetch).toBe("function");
  });

  it("should return a function when called", () => {
    const result = customFetch({
      headers: { "x-api-key": "test" },
    });
    expect(typeof result).toBe("function");
  });

  it("should handle requestOptions with Authorization header", () => {
    const result = customFetch({
      headers: { Authorization: "Bearer custom-token" },
    });
    expect(typeof result).toBe("function");
  });

  it("should handle requestOptions with x-api-key header", () => {
    const result = customFetch({
      headers: { "x-api-key": "custom-key" },
    });
    expect(typeof result).toBe("function");
  });

  it("should handle requestOptions with both auth headers", () => {
    const result = customFetch({
      headers: {
        Authorization: "Bearer custom-token",
        "x-api-key": "custom-key",
      },
    });
    expect(typeof result).toBe("function");
  });

  it("should handle empty requestOptions", () => {
    const result = customFetch({});
    expect(typeof result).toBe("function");
  });

  it("should handle undefined requestOptions", () => {
    const result = customFetch(undefined);
    expect(typeof result).toBe("function");
  });

  it("should handle case variations in header names", () => {
    // lowercase authorization
    const result1 = customFetch({
      headers: { authorization: "Bearer custom" },
    });
    expect(typeof result1).toBe("function");

    // uppercase X-Api-Key
    const result2 = customFetch({
      headers: { "X-Api-Key": "custom" },
    });
    expect(typeof result2).toBe("function");
  });
});

describe("OpenAI-compatible custom API key authentication", () => {
  it.each(["api-key", "Api-Key", "x-api-key", "X-Api-Key"])(
    "sends %s without the SDK default Bearer header",
    async (apiKeyHeader) => {
      let resolveHeaders: (headers: IncomingHttpHeaders) => void = () => {};
      const receivedHeaders = new Promise<IncomingHttpHeaders>((resolve) => {
        resolveHeaders = resolve;
      });
      const server = createServer((request, response) => {
        resolveHeaders(request.headers);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: "test-id",
            object: "chat.completion",
            created: 1234567890,
            model: "test-model",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "pong" },
                finish_reason: "stop",
              },
            ],
          }),
        );
      });

      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });

      try {
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("Could not determine test server address");
        }
        const api = new OpenAIApi({
          provider: "openai-compatible",
          apiKey: "sdk-default-test-key",
          apiBase: `http://127.0.0.1:${address.port}/v1/`,
          requestOptions: {
            headers: { [apiKeyHeader]: "custom-test-key" },
          },
        });

        await api.chatCompletionNonStream(
          {
            model: "test-model",
            messages: [{ role: "user", content: "ping" }],
          },
          new AbortController().signal,
        );

        const headers = await receivedHeaders;
        expect(headers[apiKeyHeader.toLowerCase()]).toBe("custom-test-key");
        expect(headers.authorization).toBeUndefined();
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
    },
  );
});
