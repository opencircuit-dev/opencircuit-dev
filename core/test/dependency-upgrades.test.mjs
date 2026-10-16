import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);

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

test("dbinfoz schema queries remain compatible with mssql 12 without opening a connection", async (context) => {
  const dbRequire = createRequire(require.resolve("dbinfoz"));
  const mssql = dbRequire("mssql");
  const inputs = [];
  const queries = [];
  const connect = context.mock.method(
    mssql.ConnectionPool.prototype,
    "connect",
    async function () {
      return this;
    },
  );
  context.mock.method(mssql.ConnectionPool.prototype, "request", function () {
    return {
      input(name, value) {
        inputs.push({ name, value });
        return this;
      },
      async query(sql) {
        queries.push(sql);
        return {
          recordset: sql.includes("INFORMATION_SCHEMA.TABLES")
            ? [{ TABLE_NAME: "accounts" }]
            : [{ COLUMN_NAME: "id", DATA_TYPE: "int" }],
        };
      },
    };
  });
  const { getDatabaseAdapter } = await import("dbinfoz");
  const adapter = getDatabaseAdapter("mssql", {
    server: "127.0.0.1",
    database: "dependency_compatibility_fixture",
  });
  await Promise.resolve();
  assert.deepEqual(await adapter.getAllTablesAndSchemas(), {
    accounts: { id: "int" },
  });
  assert.equal(connect.mock.callCount(), 1);
  assert.equal(queries.length, 2);
  assert.deepEqual(inputs, [
    { name: "database", value: "dependency_compatibility_fixture" },
    { name: "tableName", value: "accounts" },
  ]);
});

test("Core lockfile contains no sprintf-js dependency", () => {
  const lock = JSON.parse(
    fs.readFileSync(new URL("../package-lock.json", import.meta.url)),
  );
  assert.equal(
    Object.keys(lock.packages).some((entry) =>
      /(?:^|\/)node_modules\/sprintf-js$/.test(entry),
    ),
    false,
  );
  assert.equal(lock.packages["node_modules/js-yaml"].version, "4.3.2");
  assert.equal(lock.packages["node_modules/mssql"].version, "12.7.9");
});
