import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const require = createRequire(import.meta.url);

test("dependency policy permits a removed once chain but rejects unsafe nested copies", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "ocircuit-dependency-policy-"),
  );
  try {
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "@opencircuit/core",
        overrides: { "@tootallnate/once": "2.0.1" },
      }),
    );
    for (const [packages, expected] of [
      [{}, 0],
      [
        {
          "node_modules/parent/node_modules/@tootallnate/once": {
            version: "2.0.1",
          },
        },
        0,
      ],
      [{ "node_modules/@tootallnate/once": { version: "1.0.0" } }, 1],
      [
        {
          "node_modules/parent/node_modules/@tootallnate/once": {
            version: "1.0.0",
          },
        },
        1,
      ],
    ]) {
      fs.writeFileSync(
        path.join(root, "package-lock.json"),
        JSON.stringify({ packages }),
      );
      const result = spawnSync(
        process.execPath,
        [
          new URL("../../scripts/check-dependency-policy.mjs", import.meta.url)
            .pathname,
        ],
        { cwd: root, encoding: "utf8" },
      );
      assert.ifError(result.error);
      assert.equal(result.status, expected, result.stderr);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("minimatch backport bounds preprocessing and preserves regex consumers", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
      import assert from "node:assert/strict";
      import { createRequire } from "node:module";
      import { Minimatch, makeRe, minimatch } from "minimatch";
      const pattern = Array(30).fill("**/../a/b").join("/");
      const options = { optimizationLevel: 2, braceExpandMax: 64 };
      assert.equal(new Minimatch(pattern, options).set.length, 64);
      const commonjs = createRequire(import.meta.url)("minimatch");
      assert.equal(new commonjs.Minimatch(pattern, options).set.length, 64);
      const large = new Minimatch("{x,*}/{0..999}", { optimizationLevel: 2 });
      assert.equal(large.set.length, 2000);
      assert.equal(large.match("y/999"), true);
      assert.equal(large.match(".y/5"), false);
      assert.equal(makeRe("src/**/*.ts").test("src/nested/file.ts"), true);
      assert.equal(minimatch("src/file.js", "src/**/*.ts"), false);
    `,
    ],
    { cwd: new URL("..", import.meta.url), encoding: "utf8", timeout: 10_000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test("deepmerge blocks prototype poisoning from both inputs and nested arrays", () => {
  const merge = require("deepmerge");
  const poison = JSON.parse(
    '{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true},"safe":1}',
  );
  for (const merged of [
    merge(poison, {}),
    merge({}, poison),
    merge({ nested: poison }, { values: [poison] }),
  ]) {
    for (const value of [merged, merged.nested, merged.values?.[0]].filter(
      Boolean,
    )) {
      assert.equal(Object.getPrototypeOf(value), Object.prototype);
      assert.equal(value.polluted, undefined);
      assert.equal(Object.hasOwn(value, "__proto__"), false);
      assert.equal(Object.hasOwn(value, "constructor"), false);
      assert.equal(Object.hasOwn(value, "prototype"), false);
    }
  }
  assert.equal({}.polluted, undefined);
  assert.deepEqual(
    merge.all([
      { values: [1], config: { a: 1 } },
      { values: [2], config: { b: 2 } },
    ]),
    {
      values: [1, 2],
      config: { a: 1, b: 2 },
    },
  );
  assert.deepEqual(
    merge(
      { values: [1] },
      { values: [2] },
      { arrayMerge: (_target, source) => source },
    ),
    { values: [2] },
  );
});

test("SQLite native driver supports persisted parameterized transactions", async () => {
  const { open } = require("sqlite");
  const sqlite3 = require("sqlite3");
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "ocircuit-sqlite-upgrade-"),
  );
  const filename = path.join(root, "test.sqlite");
  let db;
  try {
    db = await open({ filename, driver: sqlite3.Database });
    await db.exec(
      "CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT); BEGIN",
    );
    const result = await db.run("INSERT INTO records (value) VALUES (?)", [
      "text'); DROP TABLE records; --",
    ]);
    assert.equal(result.lastID, 1);
    assert.equal(result.changes, 1);
    await db.exec("COMMIT");
    await db.close();
    db = await open({ filename, driver: sqlite3.Database });
    assert.deepEqual(await db.all("SELECT value FROM records"), [
      { value: "text'); DROP TABLE records; --" },
    ]);
  } finally {
    if (db) await db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ADF runtime keeps Jira paragraph and mark conversion without lint dependencies", () => {
  const convert = require("adf-to-md");
  const result = convert.convert({
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Hello " },
          { type: "text", text: "world", marks: [{ type: "strong" }] },
        ],
      },
    ],
  }).result;
  assert.match(result, /Hello \*\*world\*\*/);
});

test("coverage config loader supports YAML and extended configuration with js-yaml 4", async () => {
  const { loadNycConfig } = require("@istanbuljs/load-nyc-config");
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "ocircuit-coverage-config-"),
  );
  try {
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ nyc: { reporter: ["text"] } }),
    );
    fs.writeFileSync(
      path.join(root, "base.yaml"),
      "include:\n  - src/**/*.ts\nextension: .ts\n",
    );
    fs.writeFileSync(
      path.join(root, ".nycrc.yaml"),
      "extends: ./base.yaml\nall: true\nexclude:\n  - '**/*.fixture.ts'\n",
    );
    const config = await loadNycConfig({ cwd: root });
    assert.equal(config.all, true);
    assert.deepEqual(config.include, ["src/**/*.ts"]);
    assert.deepEqual(config.extension, [".ts"]);
    assert.deepEqual(config.exclude, ["**/*.fixture.ts"]);
    assert.deepEqual(config.reporter, ["text"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Core lockfile excludes retired database drivers and sprintf-js", () => {
  const lock = JSON.parse(
    fs.readFileSync(new URL("../package-lock.json", import.meta.url)),
  );
  for (const name of [
    "dbinfoz",
    "mssql",
    "tedious",
    "@azure/identity",
    "@azure/msal-node",
    "sprintf-js",
  ]) {
    assert.equal(
      Object.keys(lock.packages).some(
        (entry) =>
          entry === `node_modules/${name}` ||
          entry.endsWith(`/node_modules/${name}`),
      ),
      false,
      `${name} must not be reintroduced`,
    );
  }
  assert.equal(lock.packages["node_modules/js-yaml"].version, "4.3.2");
});
