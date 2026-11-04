import { describe, expect, it } from "vitest";

import {
  MissingToolArgumentsError,
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
});
