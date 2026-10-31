import { describe, expect, it } from "@jest/globals";

import {
  compileToolSchema,
  regexEngineInfo,
  validateArgs,
} from "./schemaValidator.js";

const obj = (props: any, extra: any = {}) => ({
  type: "object",
  properties: props,
  ...extra,
});

describe("compileToolSchema", () => {
  it("accepts a plain schema and validates args", () => {
    const c = compileToolSchema(
      obj({ n: { type: "number" } }, { required: ["n"] }),
    );
    if (!c.ok) throw new Error("expected ok");
    expect(validateArgs(c, { n: 1 })).toEqual({ ok: true });
    const bad = validateArgs(c, { n: "x" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("invalid_arguments");
  });

  it("accepts catastrophic-looking patterns and evaluates them in linear time", () => {
    const c = compileToolSchema(
      obj({ s: { type: "string", pattern: "^(a+)+$" } }),
    );
    if (!c.ok) throw new Error("expected ok");
    const start = Date.now();
    const r = validateArgs(c, { s: "a".repeat(100_000) + "!" });
    expect(Date.now() - start).toBeLessThan(2000);
    expect(r.ok).toBe(false);
  });

  it.each([
    ["backreference", "(a)\\1"],
    ["lookahead", "(?=a)a"],
  ])(
    "rejects patterns RE2 cannot compile (%s) with a stable code",
    (_n, pattern) => {
      const c = compileToolSchema(obj({ s: { type: "string", pattern } }));
      expect(c).toMatchObject({
        ok: false,
        code: "schema_pattern_unsupported",
      });
    },
  );

  it("covers pattern and patternProperties, nested and via $ref", () => {
    const bad = "(?=a)a";
    for (const schema of [
      obj({}, { patternProperties: { [bad]: { type: "string" } } }),
      obj({ a: { type: "object", patternProperties: { [bad]: {} } } }),
      {
        ...obj({ a: { $ref: "#/$defs/p" } }),
        $defs: { p: { type: "string", pattern: bad } },
      },
    ]) {
      expect(compileToolSchema(schema)).toMatchObject({
        ok: false,
        code: "schema_pattern_unsupported",
      });
    }
  });

  it("applies patternProperties through RE2 at validation time", () => {
    const c = compileToolSchema(
      obj(
        {},
        {
          patternProperties: { "^x_": { type: "number" } },
          additionalProperties: true,
        },
      ),
    );
    if (!c.ok) throw new Error("expected ok");
    expect(validateArgs(c, { x_a: 1 }).ok).toBe(true);
    expect(validateArgs(c, { x_a: "no" }).ok).toBe(false);
  });

  it("digest binds the schema and the regex engine", () => {
    const a = compileToolSchema(obj({ n: { type: "number" } }));
    const b = compileToolSchema(obj({ n: { type: "string" } }));
    const again = compileToolSchema(obj({ n: { type: "number" } }));
    if (!a.ok || !b.ok || !again.ok) throw new Error("expected ok");
    expect(a.digest).toBe(again.digest);
    expect(a.digest).not.toBe(b.digest);
    expect(a.engine).toEqual(regexEngineInfo());
    expect(a.engine.name).toBe("re2");
  });

  it("is insensitive to key order", () => {
    const a = compileToolSchema({
      type: "object",
      properties: { a: {}, b: {} },
    });
    const b = compileToolSchema({
      properties: { b: {}, a: {} },
      type: "object",
    });
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.digest).toBe(b.digest);
  });

  it("fails closed when no RE2 engine loads, only for schemas that use patterns", () => {
    const load = () => {
      throw new Error("Cannot find module './build/Release/re2.node'");
    };
    expect(
      compileToolSchema(obj({ s: { type: "string", pattern: "a" } }), {
        loadRe2: load,
      }),
    ).toMatchObject({ ok: false, code: "regex_engine_unavailable" });
    expect(
      compileToolSchema(obj({ n: { type: "number" } }), { loadRe2: load }).ok,
    ).toBe(true);
  });

  it("rejects non-object schemas and oversized arguments", () => {
    expect(compileToolSchema(null as any)).toMatchObject({
      ok: false,
      code: "schema_invalid",
    });
    const c = compileToolSchema(obj({ s: { type: "string" } }));
    if (!c.ok) throw new Error("expected ok");
    expect(validateArgs(c, { s: "x".repeat(2_000_000) })).toMatchObject({
      ok: false,
      code: "arguments_too_large",
    });
  });

  it("fails closed on malformed schemas, remote refs and oversized schemas", () => {
    expect(compileToolSchema({ type: "nonsense" })).toMatchObject({
      ok: false,
      code: "schema_invalid",
    });
    expect(
      compileToolSchema(obj({ a: { $ref: "https://example.com/s.json" } })),
    ).toMatchObject({ ok: false, code: "schema_invalid" });
    expect(
      compileToolSchema(obj({ a: { description: "x".repeat(300_000) } })),
    ).toMatchObject({ ok: false, code: "schema_invalid" });
  });

  it("accepts a draft-07 $schema declaration under the 2020-12 profile", () => {
    const c = compileToolSchema({
      $schema: "http://json-schema.org/draft-07/schema#",
      ...obj({ n: { type: "number" } }),
    });
    expect(c.ok).toBe(true);
  });
});
