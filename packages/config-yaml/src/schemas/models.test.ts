import { z } from "zod";
import { configYamlSchema } from "./index.js";
import { embeddingPrefixesSchema, requestOptionsSchema } from "./models.js";

describe("requestOptionsSchema", () => {
  it("rejects configuration that would authorize private URL destinations", () => {
    expect(() =>
      requestOptionsSchema.parse({
        localUrlOrigins: ["http://localhost:3000"],
      }),
    ).toThrow();
  });

  it("rejects non-string local URL origins", () => {
    expect(
      requestOptionsSchema.safeParse({
        localUrlOrigins: [3000],
      }).success,
    ).toBe(false);
  });

  it("preserves arbitrary headers and structured extra body properties", () => {
    const options = {
      headers: { "X-Deployment": "development" },
      extraBodyProperties: { routing: { region: "west" }, count: 2 },
    };
    expect(requestOptionsSchema.parse(options)).toEqual(options);
    expect(
      requestOptionsSchema.safeParse({ headers: { "X-Deployment": 2 } })
        .success,
    ).toBe(false);
  });
});

describe("embeddingPrefixesSchema", () => {
  it("accepts independent query and chunk prefixes without requiring both", () => {
    for (const prefixes of [{}, { query: "query: " }, { chunk: "passage: " }]) {
      expect(embeddingPrefixesSchema.parse(prefixes)).toEqual(prefixes);
    }
    expect(
      embeddingPrefixesSchema.safeParse({ unsupported: "prefix" }).success,
    ).toBe(false);
  });
});

describe("configuration JSON schema", () => {
  it("generates a draft-7 schema retaining optional sections and map values", () => {
    const schema = z.toJSONSchema(configYamlSchema, { target: "draft-7" });
    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(schema.required).toEqual(["name", "version"]);
    expect(schema.properties?.requestOptions).toMatchObject({
      properties: {
        headers: { type: "object", additionalProperties: { type: "string" } },
      },
    });
    expect(
      configYamlSchema.parse({
        name: "test",
        version: "1",
        metadata: { custom: "retained" },
      }).metadata,
    ).toEqual({ custom: "retained" });
  });
});
