import type {
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/index.js";
import { describe, expect, it } from "vitest";

describe("OpenAI 5.23.2 type surface", () => {
  it("keeps the chat completion types available through the supported export", () => {
    const message: ChatCompletionMessageParam = {
      role: "user",
      content: "hello",
    };
    const tool: ChatCompletionTool = {
      type: "function",
      function: {
        name: "example",
        parameters: { type: "object", properties: {} },
      },
    };
    const request: Pick<
      ChatCompletionCreateParamsStreaming,
      "messages" | "model" | "stream" | "tools"
    > = {
      messages: [message],
      model: "example-model",
      stream: true,
      tools: [tool],
    };

    expect(request.messages).toEqual([message]);
    expect(request.tools).toEqual([tool]);
  });
});
