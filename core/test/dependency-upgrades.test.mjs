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
