import { validateConfigYaml } from "./validation.js";

describe("validateConfigYaml diagnostics", () => {
  it("returns only a safe category, code, and schema field path", () => {
    const errors = validateConfigYaml({
      name: "local smoke",
      version: "1.0.0",
      models: [
        {
          name: "local model",
          provider: "ollama",
          model: "olmo2:7b",
          roles: ["not-a-model-role" as never],
        },
      ],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      fatal: true,
      diagnosticCategory: "schema_validation",
      diagnosticCode: "invalid_value",
      diagnosticPath: "models[0].roles[0]",
    });
  });
});
