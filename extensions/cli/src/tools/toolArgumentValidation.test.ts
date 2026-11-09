import { describe, expect, it } from "vitest";

import {
  MissingToolArgumentsError,
  formatMissingArgumentsFeedback,
  validateToolCallArgsPresent,
} from "./toolArgumentValidation.js";
import { writeFileTool } from "./writeFile.js";

const call = (args: unknown) => ({
  id: "write",
  name: "Write",
  arguments: args,
  argumentsStr: "{}",
  startNotified: false,
});
describe("required argument recovery classification", () => {
  it("reports all missing required fields without substituting an unproven alias", () => {
    try {
      validateToolCallArgsPresent(call({ path: "guessed.txt" }), writeFileTool);
      expect.unreachable("missing fields must fail validation");
    } catch (error) {
      expect(error).toBeInstanceOf(MissingToolArgumentsError);
      expect((error as MissingToolArgumentsError).fields).toEqual([
        "filepath",
        "content",
      ]);
    }
  });
  it.each([null, [], "{}", 42])(
    "does not offer missing-field recovery for malformed arguments %s",
    (args) => {
      try {
        validateToolCallArgsPresent(call(args), writeFileTool);
        expect.unreachable("non-object arguments must fail validation");
      } catch (error) {
        expect(error).not.toBeInstanceOf(MissingToolArgumentsError);
        expect(String(error)).toContain("must be an object");
      }
    },
  );
  it("does not accept inherited required fields", () => {
    expect(() =>
      validateToolCallArgsPresent(
        call(Object.create({ filepath: "guessed.txt", content: "hello" })),
        writeFileTool,
      ),
    ).toThrow(MissingToolArgumentsError);
  });
  it("identifies the wrong Read keys and exact required JSON shape without Write advice", () => {
    const input = {
      ...call({ path: "private-content-not-for-feedback" }),
      name: "Read",
    };
    const message = formatMissingArgumentsFeedback(
      new MissingToolArgumentsError("Read", ["filepath"]),
      input,
      { required: ["filepath"] },
    );
    expect(message).toContain("Received argument keys: path");
    expect(message).toContain('"filepath":"<exact supplied file path>"');
    expect(message).not.toContain("For Write");
    expect(message).not.toContain("private-content-not-for-feedback");
  });
  it("retains destination grounding guidance for Write", () => {
    const message = formatMissingArgumentsFeedback(
      new MissingToolArgumentsError("Write", ["filepath"]),
      call({ content: "private-content-not-for-feedback" }),
      writeFileTool.parameters,
    );
    expect(message).toContain(
      "For Write, use only a destination explicitly named by the user",
    );
    expect(message).not.toContain("private-content-not-for-feedback");
  });
});
