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

  test("classifies filesystem failures without preserving their paths", () => {
    const error = Object.assign(new Error("private path omitted"), {
      code: "ENOENT",
      path: "/private/user/config.yaml",
    });
    expect(getConfigErrorDiagnostics(error)).toEqual({
      diagnosticCategory: "config_resolution",
      diagnosticCode: "filesystem_not_found",
    });
  });

  test("classifies other thrown errors without exposing their messages", () => {
    expect(
      getConfigErrorDiagnostics(new Error("private details omitted")),
    ).toEqual({
      diagnosticCategory: "config_resolution",
      diagnosticCode: "runtime_error",
    });
  });

  test("records which config-load boundary raised an unclassified error", () => {
    expect(
      getConfigErrorDiagnostics(
        new Error("private details omitted"),
        "profile_load_error",
      ),
    ).toEqual({
      diagnosticCategory: "config_resolution",
      diagnosticCode: "profile_load_error",
    });
  });
});
