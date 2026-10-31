import { describe, expect, it } from "vitest";

import { countChatHistoryItemTokens } from "./tokenizer.js";

describe("CLI tokenizer special tokens", () => {
  it("counts special-token literals as text without throwing", () => {
    const item: any = {
      message: { role: "user", content: "a <|endoftext|> b <|fim_prefix|>" },
      contextItems: [],
    };
    const n = countChatHistoryItemTokens(item, { model: "gpt-4" } as any);
    expect(n).toBeGreaterThan(0);
  });
});
