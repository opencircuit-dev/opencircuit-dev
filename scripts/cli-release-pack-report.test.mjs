import assert from "node:assert/strict";
import test from "node:test";
import {
  isForbiddenReleaseFile,
  parseCliPackReport,
} from "./cli-release-pack-report.mjs";

const expected = { name: "@opencircuit/cli", version: "1.0.3" };
const report = { ...expected, files: [{ path: "package.json" }] };

test("excludes internal templates and nested credential files", () => {
  for (const file of [
    "templates/config-cisco.yaml",
    "templates/config-devnet.yaml",
    ".env",
    "nested/.env.local",
    "nested/.npmrc",
    "nested/credentials.json",
    "credentials/key",
    "nested/private.KEY",
    "nested/certificate.pem",
    "node_modules/dependency/index.js",
  ]) {
    assert.equal(isForbiddenReleaseFile(file), true, file);
  }
  assert.equal(isForbiddenReleaseFile("templates/config-meta.yaml"), false);
  assert.equal(isForbiddenReleaseFile("dist/index.js"), false);
});

test("accepts array and package-keyed npm pack reports", () => {
  for (const input of [[report], { [expected.name]: report }]) {
    assert.deepEqual(
      parseCliPackReport(JSON.stringify(input), expected),
      report,
    );
  }
});

test("rejects missing, ambiguous and mismatched packages", () => {
  for (const input of [
    null,
    [],
    {},
    [report, report],
    { [expected.name]: report, other: report },
    [{ ...report, name: "other" }],
    [{ ...report, version: "1.0.4" }],
    [{ ...report, files: [] }],
    [{ ...report, files: null }],
  ]) {
    assert.throws(() => parseCliPackReport(JSON.stringify(input), expected));
  }
  assert.throws(() => parseCliPackReport("not JSON", expected));
});

test("rejects unsafe file paths", () => {
  for (const filePath of [
    "/tmp/file",
    "../file",
    "dist/../file",
    "dist//file",
    "dist\\file",
    "file\n",
    "",
  ]) {
    assert.throws(() =>
      parseCliPackReport(
        JSON.stringify([{ ...report, files: [{ path: filePath }] }]),
        expected,
      ),
    );
  }
});
