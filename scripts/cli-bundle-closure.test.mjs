import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import {
  collectInstallTimePackages,
  isLicenseAllowed,
  readLicenseAllowlist,
  repositoryRoot,
  thirdPartyPackageRoot,
} from "./cli-bundle-closure.mjs";

const allowed = new Set(["MIT", "Apache-2.0", "ISC"]);

test("vendored third-party source is not classified as first-party code", () => {
  assert.equal(
    thirdPartyPackageRoot(
      resolve(repositoryRoot, "vendor/minimatch/dist/esm/index.js"),
    ),
    resolve(repositoryRoot, "vendor/minimatch"),
  );
  assert.equal(
    thirdPartyPackageRoot(
      resolve(repositoryRoot, "packages/config-yaml/src/index.ts"),
    ),
    undefined,
  );
  assert.equal(
    thirdPartyPackageRoot(
      resolve(
        repositoryRoot,
        "node_modules/chalk/source/vendor/ansi-styles/index.js",
      ),
    ),
    resolve(repositoryRoot, "node_modules/chalk"),
  );
});

test("accepts allowlisted identifiers and rejects everything else", () => {
  assert.equal(isLicenseAllowed("MIT", allowed), true);
  assert.equal(isLicenseAllowed("GPL-3.0-only", allowed), false);
  assert.equal(isLicenseAllowed("LGPL-3.0-or-later", allowed), false);
  assert.equal(isLicenseAllowed("SSPL-1.0", allowed), false);
  assert.equal(isLicenseAllowed("UNKNOWN", allowed), false);
});

test("OR passes when any branch is allowed; AND needs every part", () => {
  assert.equal(isLicenseAllowed("MIT OR GPL-3.0-only", allowed), true);
  assert.equal(isLicenseAllowed("(GPL-2.0-only OR Apache-2.0)", allowed), true);
  assert.equal(isLicenseAllowed("MIT AND GPL-3.0-only", allowed), false);
  assert.equal(
    isLicenseAllowed("(MIT AND ISC) OR LGPL-2.1-only", allowed),
    true,
  );
  assert.equal(
    isLicenseAllowed("(MIT OR ISC) AND LGPL-2.1-only", allowed),
    false,
  );
});

test("WITH exceptions must be allowlisted explicitly", () => {
  assert.equal(
    isLicenseAllowed("Apache-2.0 WITH LLVM-exception", allowed),
    false,
  );
  assert.equal(
    isLicenseAllowed(
      "Apache-2.0 WITH LLVM-exception",
      new Set([...allowed, "WITH LLVM-exception"]),
    ),
    true,
  );
});

test("malformed expressions are rejected", () => {
  for (const expression of [
    "",
    "MIT OR",
    "(MIT",
    "MIT)",
    "AND MIT",
    "MIT ISC",
  ]) {
    assert.equal(isLicenseAllowed(expression, allowed), false, expression);
  }
});

test("approved BlueOak is allowed without admitting unapproved license combinations", () => {
  const repositoryAllowlist = readLicenseAllowlist();
  assert.equal(isLicenseAllowed("BlueOak-1.0.0", repositoryAllowlist), true);
  assert.equal(
    isLicenseAllowed("BlueOak-1.0.0 AND GPL-3.0-only", repositoryAllowlist),
    false,
  );
});

test("repository allowlist includes the bundled permissive licenses", () => {
  const repositoryAllowlist = readLicenseAllowlist();
  for (const license of [
    "Apache-2.0",
    "MIT",
    "MIT-0",
    "ISC",
    "BSD-2-Clause",
    "BSD-3-Clause",
  ]) {
    assert.ok(repositoryAllowlist.has(license), license);
  }
});

test("upstream Python license allowance requires separate internal approval", () => {
  assert.equal(isLicenseAllowed("Python-2.0", readLicenseAllowlist()), false);
});

test("collects the published install-time closure without dev-only packages", () => {
  const installTime = collectInstallTimePackages();
  const ids = new Set(
    installTime.map((entry) => `${entry.name}@${entry.version}`),
  );

  assert.ok(ids.has("argparse@2.0.1"));
  assert.equal(
    [...ids].some((id) => id.startsWith("minimatch@")),
    false,
  );
  assert.equal(
    [...ids].some((id) => id.startsWith("@img/sharp-")),
    false,
  );
  assert.ok(installTime.every((entry) => entry.installTime === true));
});
