import { describe, expect, it } from "vitest";

import {
  StdioFrameDecoder,
  StdioFrameError,
  encodeStdioFrame,
} from "./framing.js";

describe("AHP stdio framing", () => {
  it("decodes split and combined frames", () => {
    const bytes = Buffer.concat([
      encodeStdioFrame({ id: 1 }),
      encodeStdioFrame({ id: 2 }),
    ]);
    const decoder = new StdioFrameDecoder();
    expect(decoder.push(bytes.subarray(0, 3))).toEqual([]);
    expect(decoder.push(bytes.subarray(3))).toEqual([{ id: 1 }, { id: 2 }]);
    decoder.finish();
  });

  it("rejects zero-length, oversized and malformed frames", () => {
    const decoder = new StdioFrameDecoder(8);
    expect(() => decoder.push(Buffer.from([0, 0, 0, 0]))).toThrow(
      StdioFrameError,
    );
    expect(() => decoder.push(Buffer.from([0, 0, 0, 9]))).toThrow(
      StdioFrameError,
    );
    const malformed = Buffer.concat([
      Buffer.from([0, 0, 0, 1]),
      Buffer.from("{"),
    ]);
    expect(() => new StdioFrameDecoder().push(malformed)).toThrow(
      StdioFrameError,
    );
  });

  it("bounds incomplete-frame buffering", () => {
    const decoder = new StdioFrameDecoder(8);
    expect(() => decoder.push(Buffer.alloc(13))).toThrow(StdioFrameError);
  });
});
