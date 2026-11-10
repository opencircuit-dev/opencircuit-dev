import { describe, expect, it } from "vitest";

import { readFileTool } from "./readFile.js";
import {
  normalizeReadFileArgs,
  normalizeReadFileCall,
} from "./readFileArguments.js";
import { writeFileTool } from "./writeFile.js";

const call = (args: unknown, name = "Read") => ({
  id: "read",
  name,
  arguments: args,
  argumentsStr: JSON.stringify(args),
  startNotified: false,
});
describe("evidence-backed built-in Read argument normalization", () => {
  it("renames only file_path and preserves the exact path and original payload", () => {
    const original = call({ file_path: "./configs/cli/iosxe-ikev2-ipsec" });
    const normalized = normalizeReadFileCall(original, readFileTool);
    expect(normalized.arguments).toEqual({
      filepath: "./configs/cli/iosxe-ikev2-ipsec",
    });
    expect(JSON.parse(normalized.argumentsStr)).toEqual(normalized.arguments);
    expect(normalized.id).toBe(original.id);
    expect(original.arguments).toEqual({
      file_path: "./configs/cli/iosxe-ikev2-ipsec",
    });
  });
  it.each([
    { path: "target" },
    { filePath: "target" },
    { filename: "target" },
    { file_path: "" },
    { file_path: "  " },
    { file_path: null },
    { file_path: 42 },
    { file_path: "one", path: "two" },
    { file_path: "one", extra: true },
    { filepath: null, file_path: "target" },
    { filepath: "one", file_path: "two" },
  ])(
    "does not reinterpret unknown, invalid or conflicting fields: %j",
    (args) => {
      const input = call(args);
      expect(normalizeReadFileCall(input, readFileTool)).toBe(input);
    },
  );
  it("does not change canonical calls or override their target", () => {
    const input = call({ filepath: "original", file_path: "different" });
    expect(normalizeReadFileCall(input, readFileTool)).toBe(input);
  });
  it("does not infer aliases for Write or an MCP tool named Read", () => {
    const input = call({ file_path: "target" });
    expect(
      normalizeReadFileCall(input, { ...readFileTool, isBuiltIn: false }),
    ).toBe(input);
    const write = call({ file_path: "target", content: "content" }, "Write");
    expect(normalizeReadFileCall(write, writeFileTool)).toBe(write);
  });
  it("does not use inherited alias values", () => {
    const args = Object.create({ file_path: "target" });
    expect(normalizeReadFileArgs(args)).toBe(args);
  });
});
