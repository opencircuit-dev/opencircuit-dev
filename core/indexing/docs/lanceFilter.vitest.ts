import { describe, expect, it } from "vitest";

import { startUrlFilter } from "./lanceFilter";

describe("startUrlFilter", () => {
  it("escapes quotes inside the LanceDB string literal", () => {
    expect(startUrlFilter("https://example.test/?q=' OR 1=1 --")).toBe(
      "starturl = 'https://example.test/?q='' OR 1=1 --'",
    );
  });
});
