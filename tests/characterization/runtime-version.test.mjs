import assert from "node:assert/strict";
import test from "node:test";

import {
  isSupportedNodeVersion,
  SUPPORTED_NODE_RANGE,
} from "./runtime-version.mjs";

test("documents the supported Node.js range", () => {
  assert.equal(SUPPORTED_NODE_RANGE, ">=24.19.0 <27");
});

for (const [version, expected] of [
  ["24.18.0", false],
  ["24.19.0", true],
  ["v26.7.0", true],
  ["27.0.0", false],
  ["not-a-version", false],
]) {
  test(`Node ${version} is ${expected ? "supported" : "unsupported"}`, () => {
    assert.equal(isSupportedNodeVersion(version), expected);
  });
}
