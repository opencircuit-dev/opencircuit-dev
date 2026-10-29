import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import * as fs from "node:fs";
import * as path from "node:path";

export interface TokenizerAdapterDeclaration {
  packageName: string;
  packageVersion: string;
  mode: string;
  specialTokenPolicy: string;
  bosTokens: number;
  eosTokens: number;
  messageFramingTokens: number;
  maxOverhead: number;
}

const require = createRequire(import.meta.url);

function canonical(value: TokenizerAdapterDeclaration): string {
  return JSON.stringify(value, Object.keys(value).sort());
}

export function tokenizerAdapterDigest(
  declaration: TokenizerAdapterDeclaration,
): string {
  return createHash("sha256").update(canonical(declaration)).digest("hex");
}

export function installedPackageVersion(
  packageName: string,
  resolvePackage: (name: string) => string = require.resolve,
): string {
  let directory = path.dirname(resolvePackage(packageName));
  for (let i = 0; i < 6; i++) {
    try {
      const metadata = JSON.parse(
        fs.readFileSync(path.join(directory, "package.json"), "utf8"),
      ) as { name?: unknown; version?: unknown };
      if (
        metadata.name === packageName &&
        typeof metadata.version === "string"
      ) {
        return metadata.version;
      }
    } catch {
      // Walk upward until the package root is found.
    }
    directory = path.dirname(directory);
  }
  throw new Error(`Tokenizer package ${packageName} has no readable version`);
}

// Bundled builds (the packaged CLI) inline the tokenizer, so the package is
// not on disk; the lockfile pinned its version at bundle time.
export function optionalInstalledPackageVersion(
  packageName: string,
  resolvePackage: (name: string) => string = require.resolve,
): string | undefined {
  try {
    resolvePackage(packageName);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "MODULE_NOT_FOUND") {
      return undefined;
    }
    throw err;
  }
  return installedPackageVersion(packageName, resolvePackage);
}

export function assertTokenizerAdapter(
  declaration: TokenizerAdapterDeclaration,
  expectedDigest: string,
  verifyInstalledPackage = true,
  resolvePackage: (name: string) => string = require.resolve,
): void {
  if (
    declaration.bosTokens < 0 ||
    declaration.eosTokens < 0 ||
    declaration.messageFramingTokens < 0 ||
    declaration.maxOverhead <
      declaration.bosTokens +
        declaration.eosTokens +
        declaration.messageFramingTokens
  ) {
    throw new Error("Invalid tokenizer adapter overhead declaration");
  }
  if (tokenizerAdapterDigest(declaration) !== expectedDigest) {
    throw new Error(
      `Tokenizer adapter declaration changed for ${declaration.packageName}; re-verify its bound and digest`,
    );
  }
  if (verifyInstalledPackage) {
    const actual = optionalInstalledPackageVersion(
      declaration.packageName,
      resolvePackage,
    );
    if (actual !== undefined && actual !== declaration.packageVersion) {
      throw new Error(
        `Tokenizer package ${declaration.packageName}@${actual} does not match declared ${declaration.packageVersion}`,
      );
    }
  }
}

export const CORE_TIKTOKEN_ADAPTER: TokenizerAdapterDeclaration = Object.freeze(
  {
    packageName: "js-tiktoken",
    packageVersion: "1.0.21",
    mode: "gpt-4/cl100k_base",
    specialTokenPolicy: "allowed:all;disallowed:empty;positional",
    bosTokens: 0,
    eosTokens: 0,
    messageFramingTokens: 0,
    maxOverhead: 0,
  },
);

export const CORE_LLAMA_ADAPTER: TokenizerAdapterDeclaration = Object.freeze({
  packageName: "embedded-llama-tokenizer",
  packageVersion: "embedded-v1",
  mode: "byte-fallback",
  specialTokenPolicy: "native",
  bosTokens: 1,
  eosTokens: 1,
  messageFramingTokens: 0,
  maxOverhead: 2,
});

export const CORE_TOKENIZER_ADAPTER_DIGESTS = Object.freeze({
  tiktoken: "0e7dccdf20bdf8d4d4aed96631edaab9d47ce9a560041bff956705bb6b76b6f4",
  llama: "1cad818289156fbade25eb50c900ae2f6d60b5dda812044a5d138a6cc4297e90",
});

export function assertCoreTokenizerAdapters(): void {
  assertTokenizerAdapter(
    CORE_TIKTOKEN_ADAPTER,
    CORE_TOKENIZER_ADAPTER_DIGESTS.tiktoken,
  );
  assertTokenizerAdapter(
    CORE_LLAMA_ADAPTER,
    CORE_TOKENIZER_ADAPTER_DIGESTS.llama,
    false,
  );
}
