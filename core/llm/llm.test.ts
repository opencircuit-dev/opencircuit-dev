import { jest } from "@jest/globals";

import { AssistantChatMessage, CompletionOptions } from "..";

import Anthropic from "./llms/Anthropic";
import Mistral from "./llms/Mistral";
import OpenAI from "./llms/OpenAI";

import { BaseLLM } from ".";
import { anthropicFixtures } from "../test/fixtures/providers/anthropic";
import { mistralFixtures } from "../test/fixtures/providers/mistral";
import { openAiFixtures } from "../test/fixtures/providers/openai";

const COMPLETION_OPTIONS: Partial<CompletionOptions> = {
  topP: 1,
  topK: 40,
  presencePenalty: 0,
  frequencyPenalty: 0,
};

type MockTransport =
  | { json: unknown; sse?: never }
  | { json?: never; sse: Array<object | string> };

function applyCompletionOptions<T extends BaseLLM>(llm: T): T {
  llm.completionOptions = { ...llm.completionOptions, ...COMPLETION_OPTIONS };
  return llm;
}

function createSseResponse(events: Array<object | string>) {
  const body = events
    .map(
      (event) =>
        `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`,
    )
    .join("");

  return new Response(body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function createJsonResponse(json: unknown) {
  return new Response(JSON.stringify(json), {
    headers: { "Content-Type": "application/json" },
  });
}

function installMockTransport(llm: BaseLLM, transport: MockTransport) {
  const response =
    "json" in transport
      ? createJsonResponse(transport.json)
      : createSseResponse(transport.sse);
  const mockFetch = jest.fn(async () => response);

  (llm as any).fetch = mockFetch;
  (llm as any).useOpenAIAdapterFor = [];

  return mockFetch;
}

async function collectChat(llm: BaseLLM) {
  let total = "";
  for await (const chunk of llm.streamChat(
    [{ role: "user", content: "Hi" }],
    new AbortController().signal,
  )) {
    total += chunk.content;
  }
  return total;
}

async function collectCompletion(llm: BaseLLM) {
  let total = "";
  for await (const chunk of llm.streamComplete(
    "Hi",
    new AbortController().signal,
  )) {
    total += chunk;
  }
  return total;
}

async function runComplete(llm: BaseLLM) {
  return llm.complete("Hi", new AbortController().signal);
}

async function collectToolArguments(llm: BaseLLM) {
  let args = "";
  let isFirstChunk = true;

  for await (const chunk of llm.streamChat(
    [{ role: "user", content: "Hi, my name is Nate." }],
    new AbortController().signal,
    {
      tools: [
        {
          displayTitle: "Say Hello",
          function: {
            name: "say_hello",
            description: "Say Hello",
            parameters: {
              type: "object",
              required: ["name"],
              properties: {
                name: {
                  type: "string",
                  description: "The name of the person to greet",
                },
              },
            },
          },
          type: "function",
          wouldLikeTo: "say hello",
          isCurrently: "saying hello",
          hasAlready: "said hello",
          readonly: true,
          group: "Hello",
        },
      ],
      toolChoice: { type: "function", function: { name: "say_hello" } },
    },
  )) {
    const typedChunk = chunk as AssistantChatMessage;
    if (!typedChunk.toolCalls || typedChunk.toolCalls.length === 0) {
      continue;
    }

    const toolCall = typedChunk.toolCalls[0];
    args += toolCall.function?.arguments ?? "";

    expect(chunk.role).toBe("assistant");
    expect(chunk.content).toBe("");
    expect(typedChunk.toolCalls).toHaveLength(1);

    if (isFirstChunk) {
      isFirstChunk = false;
      expect(toolCall.id).toBeDefined();
      expect(toolCall.function?.name).toBe("say_hello");
    }
  }

  return JSON.parse(args);
}

describe("LLM deletion-gate provider coverage", () => {
  describe("Anthropic", () => {
    const createLlm = () =>
      applyCompletionOptions(
        new Anthropic({
          model: "claude-sonnet-4-0",
          apiKey: "fixture-anthropic-key",
          apiBase: "https://api.anthropic.com/v1/",
        }),
      );

    test("Stream Chat works without external credentials", async () => {
      const llm = createLlm();
      installMockTransport(llm, { sse: anthropicFixtures.streamChat });

      const total = await collectChat(llm);
      expect(total.length).toBeGreaterThan(0);
    });

    test("Stream Complete works without external credentials", async () => {
      const llm = createLlm();
      installMockTransport(llm, { sse: anthropicFixtures.streamChat });

      const total = await collectCompletion(llm);
      expect(total.length).toBeGreaterThan(0);
    });

    test("Complete works without external credentials", async () => {
      const llm = createLlm();
      installMockTransport(llm, { sse: anthropicFixtures.streamChat });

      const completion = await runComplete(llm);
      expect(completion.length).toBeGreaterThan(0);
    });

    test("Tool Call works without external credentials", async () => {
      const llm = createLlm();
      installMockTransport(llm, { sse: anthropicFixtures.toolCall });

      const parsedArgs = await collectToolArguments(llm);
      expect(parsedArgs.name).toBe("Nate");
    });
  });

  describe("OpenAI", () => {
    const createChatLlm = (model: string) =>
      applyCompletionOptions(
        new OpenAI({
          apiKey: "fixture-openai-key",
          model,
          apiBase: "https://api.openai.com/v1/",
        }),
      );

    test("gpt-4o Stream Chat works without external credentials", async () => {
      const llm = createChatLlm("gpt-4o");
      installMockTransport(llm, { sse: openAiFixtures.streamChat });

      const total = await collectChat(llm);
      expect(total.length).toBeGreaterThan(0);
    });

    test("gpt-4o Stream Complete works without external credentials", async () => {
      const llm = createChatLlm("gpt-4o");
      installMockTransport(llm, { sse: openAiFixtures.streamChat });

      const total = await collectCompletion(llm);
      expect(total.length).toBeGreaterThan(0);
    });

    test("gpt-4o Complete works without external credentials", async () => {
      const llm = createChatLlm("gpt-4o");
      installMockTransport(llm, { sse: openAiFixtures.streamChat });

      const completion = await runComplete(llm);
      expect(completion.length).toBeGreaterThan(0);
    });

    test("gpt-4o Tool Call works without external credentials", async () => {
      const llm = createChatLlm("gpt-4o");
      installMockTransport(llm, { sse: openAiFixtures.toolCall });

      const parsedArgs = await collectToolArguments(llm);
      expect(parsedArgs.name).toBe("Nate");
    });

    test("o3-mini Stream Chat works without external credentials", async () => {
      const llm = createChatLlm("o3-mini");
      installMockTransport(llm, { sse: openAiFixtures.streamChat });

      const total = await collectChat(llm);
      expect(total.length).toBeGreaterThan(0);
    });

    test("o3-mini Stream Complete works without external credentials", async () => {
      const llm = createChatLlm("o3-mini");
      installMockTransport(llm, { sse: openAiFixtures.streamChat });

      const total = await collectCompletion(llm);
      expect(total.length).toBeGreaterThan(0);
    });

    test("o3-mini Complete works without external credentials", async () => {
      const llm = createChatLlm("o3-mini");
      installMockTransport(llm, { sse: openAiFixtures.streamChat });

      const completion = await runComplete(llm);
      expect(completion.length).toBeGreaterThan(0);
    });

    test("o1 Stream Chat works without external credentials", async () => {
      const llm = createChatLlm("o1");
      installMockTransport(llm, { json: openAiFixtures.o1Response });

      const total = await collectChat(llm);
      expect(total.length).toBeGreaterThan(0);
    });

    test("o1 Stream Complete works without external credentials", async () => {
      const llm = createChatLlm("o1");
      installMockTransport(llm, { json: openAiFixtures.o1Response });

      const total = await collectCompletion(llm);
      expect(total.length).toBeGreaterThan(0);
    });

    test("o1 Complete works without external credentials", async () => {
      const llm = createChatLlm("o1");
      installMockTransport(llm, { json: openAiFixtures.o1Response });

      const completion = await runComplete(llm);
      expect(completion.length).toBeGreaterThan(0);
    });
  });

  describe("Mistral", () => {
    const createLlm = () =>
      applyCompletionOptions(
        new Mistral({
          apiKey: "fixture-mistral-key",
          model: "codestral-latest",
          apiBase: "https://codestral.mistral.ai/v1/",
        }),
      );

    test("Stream Chat works without external credentials", async () => {
      const llm = createLlm();
      installMockTransport(llm, { sse: mistralFixtures.streamChat });

      const total = await collectChat(llm);
      expect(total.length).toBeGreaterThan(0);
    });

    test("Stream Complete works without external credentials", async () => {
      const llm = createLlm();
      installMockTransport(llm, { sse: mistralFixtures.streamChat });

      const total = await collectCompletion(llm);
      expect(total.length).toBeGreaterThan(0);
    });

    test("Complete works without external credentials", async () => {
      const llm = createLlm();
      installMockTransport(llm, { sse: mistralFixtures.streamChat });

      const completion = await runComplete(llm);
      expect(completion.length).toBeGreaterThan(0);
    });

    test("FIM works without external credentials", async () => {
      const llm = createLlm();
      installMockTransport(llm, { sse: mistralFixtures.streamFim });

      let total = "";
      for await (const chunk of llm.streamFim(
        "Hi",
        "name is ChatGPT.",
        new AbortController().signal,
      )) {
        total += chunk;
      }

      expect(total.length).toBeGreaterThan(0);
    });

    test("Tool Call works without external credentials", async () => {
      const llm = createLlm();
      installMockTransport(llm, { sse: mistralFixtures.toolCall });

      const parsedArgs = await collectToolArguments(llm);
      expect(parsedArgs.name).toBe("Nate");
    });
  });
});
