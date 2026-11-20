import { describe, expect, test } from "vitest";

import { getConfigErrorDiagnostics } from "./validation.js";

describe("getConfigErrorDiagnostics", () => {
  test("preserves bounded diagnostic fields", () => {
    expect(
      getConfigErrorDiagnostics({
        diagnosticCategory: "schema_validation",
        diagnosticCode: "invalid_value",
        diagnosticPath: "models[0].roles[0]",
      }),
    ).toEqual({
      diagnosticCategory: "schema_validation",
      diagnosticCode: "invalid_value",
      diagnosticPath: "models[0].roles[0]",
    });
  });

  test("drops unrecognized or unbounded diagnostic values", () => {
    expect(
      getConfigErrorDiagnostics({
        diagnosticCategory: "unexpected",
        diagnosticCode: "api_key=secret",
        diagnosticPath: "models.apiKey.secret-value",
      }),
    ).toEqual({});
  });
});
