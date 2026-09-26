import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getLlmApi } from "./config.js";
import { loadConfiguration } from "./configLoader.js";

describe("local provider smoke", () => {
  let server: Server | undefined;
  let testDir: string | undefined;

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error) => (error ? reject(error) : resolve()));
      });
      server = undefined;
    }
    if (testDir) {
      await rm(testDir, { recursive: true, force: true });
      testDir = undefined;
    }
  });

  it("loads OPENAI_API_KEY locally without contacting the hosted resolver", async () => {
    let requestBody = "";
    let requestPath: string | undefined;
    let authorization: string | undefined;
    server = createServer((request, response) => {
      requestPath = request.url;
      authorization = request.headers.authorization;

      request.on("data", (chunk) => {
        requestBody += chunk;
      });
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            id: "local-smoke",
            object: "chat.completion",
            created: 0,
            model: "local-model",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "local pong" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
        );
      });
    });

    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Local provider smoke server did not expose a port");
    }

    testDir = await mkdtemp(join(tmpdir(), "oc-local-provider-"));
    const configPath = join(testDir, "config.yaml");
    await writeFile(
      configPath,
      `name: Local Provider Smoke
version: 1.0.0
schema: v1
models:
  - name: local-model
    model: local-model
    provider: openai-compatible
    apiBase: http://127.0.0.1:${address.port}/v1/
    apiKey: \${{ secrets.OPENAI_API_KEY }}
    roles:
      - chat
`,
    );

    const syncSecrets = async () => {
      throw new Error("Hosted resolver must not be contacted");
    };
    const apiClient = {
      isAuthenticated: false,
      syncSecrets,
    };

    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "local-test-key";
    try {
      const loaded = await loadConfiguration(
        null,
        configPath,
        apiClient as any,
        [],
        true,
      );
      const [llmApi, model] = getLlmApi(loaded.config, null);
      const response = await llmApi.chatCompletionNonStream(
        {
          model: model.model,
          messages: [{ role: "user", content: "ping" }],
          stream: false,
        },
        new AbortController().signal,
      );

      expect(requestPath).toBe("/v1/chat/completions");
      expect(authorization).toBe("Bearer local-test-key");
      expect(response.choices[0]?.message.content).toBe("local pong");
      expect(JSON.parse(requestBody).model).toBe("local-model");
    } finally {
      if (originalKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalKey;
      }
    }
  });
});
