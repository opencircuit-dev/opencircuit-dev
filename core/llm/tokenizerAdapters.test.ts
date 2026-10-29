import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  assertTokenizerAdapter,
  CORE_TIKTOKEN_ADAPTER,
  CORE_TOKENIZER_ADAPTER_DIGESTS,
  installedPackageVersion,
  optionalInstalledPackageVersion,
} from "./tokenizerAdapters.js";

const moduleNotFound = () => {
  const err = new Error("Cannot find module") as NodeJS.ErrnoException;
  err.code = "MODULE_NOT_FOUND";
  throw err;
};

describe("optionalInstalledPackageVersion", () => {
  it("returns undefined when the package is not on disk (bundled build)", () => {
    expect(
      optionalInstalledPackageVersion("gpt-tokenizer", moduleNotFound),
    ).toBeUndefined();
  });

  it("still reports the version of a package that is installed", () => {
    expect(optionalInstalledPackageVersion("js-tiktoken")).toBe(
      installedPackageVersion("js-tiktoken"),
    );
  });

  it("does not swallow unexpected resolver failures", () => {
    expect(() =>
      optionalInstalledPackageVersion("js-tiktoken", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
  });
});

describe("assertTokenizerAdapter installed-package check", () => {
  it("still rejects a version mismatch for an installed package", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tok-adapter-"));
    try {
      fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name: "js-tiktoken", version: "9.9.9" }),
      );
      expect(() =>
        assertTokenizerAdapter(
          CORE_TIKTOKEN_ADAPTER,
          CORE_TOKENIZER_ADAPTER_DIGESTS.tiktoken,
          true,
          () => path.join(dir, "index.js"),
        ),
      ).toThrow(/does not match declared/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not throw when the package is bundled and unresolvable", () => {
    expect(() =>
      assertTokenizerAdapter(
        CORE_TIKTOKEN_ADAPTER,
        CORE_TOKENIZER_ADAPTER_DIGESTS.tiktoken,
        true,
        moduleNotFound,
      ),
    ).not.toThrow();
  });
});
