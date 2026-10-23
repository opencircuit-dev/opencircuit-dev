import { spawn } from "node:child_process";

import type { OAuthTokenSet, SecureTokenStore } from "./AuthManager.js";

export class TokenStoreUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenStoreUnavailable";
  }
}

// `security -i` rejects input lines longer than ~4 KB, so macOS token sets are
// stored as base64 chunks in numbered items with a count in the primary item.
const CHUNK_MANIFEST_PREFIX = "oc-chunks:";
const MAX_CHUNK_CHARS = 1500;
const MAX_CHUNKS = 64;
const NOT_FOUND = /not found|could not be found|no such item/i;

interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Host credential-manager storage. There is intentionally no file fallback. */
export class OsTokenStore implements SecureTokenStore {
  constructor(
    private readonly service: string,
    private readonly account: string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async load(): Promise<OAuthTokenSet | null> {
    const stored = await this.runLookup();
    if (!stored) return null;
    const result = stored.startsWith(CHUNK_MANIFEST_PREFIX)
      ? await this.loadChunks(stored)
      : stored;
    try {
      const value: unknown = JSON.parse(result);
      if (!value || typeof value !== "object") throw new Error("invalid");
      return validateStoredToken(value);
    } catch {
      throw new TokenStoreUnavailable("Stored OAuth credentials are invalid");
    }
  }

  async save(tokenSet: OAuthTokenSet): Promise<void> {
    const result = await this.runStore(JSON.stringify(tokenSet));
    if (result.code !== 0) {
      throw new TokenStoreUnavailable(
        "Host credential manager rejected OAuth credentials",
      );
    }
  }

  async clear(): Promise<void> {
    const chunkCount = await this.storedChunkCount();
    const services = [this.service];
    for (let index = 0; index < chunkCount; index++) {
      services.push(this.chunkService(index));
    }
    for (const service of services) {
      const result = await this.runClear(service);
      if (result.code !== 0 && !NOT_FOUND.test(result.stderr)) {
        throw new TokenStoreUnavailable(
          "Host credential manager could not clear OAuth credentials",
        );
      }
    }
  }

  private chunkService(index: number): string {
    return `${this.service}#${index}`;
  }

  private async storedChunkCount(): Promise<number> {
    if (this.platform !== "darwin") return 0;
    const stored = await this.runLookup().catch(() => null);
    return stored?.startsWith(CHUNK_MANIFEST_PREFIX)
      ? (parseChunkCount(stored) ?? 0)
      : 0;
  }

  private async loadChunks(manifest: string): Promise<string> {
    const count = parseChunkCount(manifest);
    if (count === null) {
      throw new TokenStoreUnavailable("Stored OAuth credentials are invalid");
    }
    let encoded = "";
    for (let index = 0; index < count; index++) {
      const chunk = await this.runLookup(this.chunkService(index));
      if (!chunk) {
        throw new TokenStoreUnavailable("Stored OAuth credentials are invalid");
      }
      encoded += chunk;
    }
    return Buffer.from(encoded, "base64").toString("utf8");
  }

  private async runLookup(service = this.service): Promise<string | null> {
    const result = await this.runCommand(
      this.platform === "darwin" ? "security" : "secret-tool",
      this.platform === "darwin"
        ? ["find-generic-password", "-a", this.account, "-s", service, "-w"]
        : ["lookup", "service", service, "account", this.account],
    );
    if (result.code !== 0) {
      if (NOT_FOUND.test(result.stderr)) {
        return null;
      }
      throw new TokenStoreUnavailable("Host credential manager is unavailable");
    }
    return result.stdout.trim() || null;
  }

  private async runStore(value: string): Promise<CommandResult> {
    if (this.platform !== "darwin" && this.platform !== "linux") {
      return Promise.reject(
        new TokenStoreUnavailable(
          "No supported host credential manager is available",
        ),
      );
    }
    if (this.platform === "darwin") {
      // Interactive mode keeps token data out of the child process argv.
      const chunks =
        Buffer.from(value, "utf8")
          .toString("base64")
          .match(new RegExp(`.{1,${MAX_CHUNK_CHARS}}`, "g")) ?? [];
      if (chunks.length === 0 || chunks.length > MAX_CHUNKS) {
        throw new TokenStoreUnavailable("OAuth credentials are too large");
      }
      const previousCount = await this.storedChunkCount();
      const lines = chunks.map((chunk, index) =>
        this.addItemCommand(this.chunkService(index), chunk),
      );
      lines.push(
        this.addItemCommand(
          this.service,
          `${CHUNK_MANIFEST_PREFIX}${chunks.length}`,
        ),
      );
      for (let index = chunks.length; index < previousCount; index++) {
        lines.push(
          [
            "delete-generic-password",
            "-a",
            quoteSecurityArgument(this.account),
            "-s",
            quoteSecurityArgument(this.chunkService(index)),
          ].join(" "),
        );
      }
      return this.runCommand("security", ["-i"], `${lines.join("\n")}\n`);
    }
    return this.runCommand(
      "secret-tool",
      [
        "store",
        "--label",
        "Open Circuit OAuth token",
        "service",
        this.service,
        "account",
        this.account,
      ],
      value,
    );
  }

  private addItemCommand(service: string, data: string): string {
    return [
      "add-generic-password",
      "-U",
      "-a",
      quoteSecurityArgument(this.account),
      "-s",
      quoteSecurityArgument(service),
      "-X",
      quoteSecurityArgument(Buffer.from(data, "utf8").toString("hex")),
    ].join(" ");
  }

  private runClear(service = this.service): Promise<CommandResult> {
    if (this.platform !== "darwin" && this.platform !== "linux") {
      return Promise.reject(
        new TokenStoreUnavailable(
          "No supported host credential manager is available",
        ),
      );
    }
    return this.runCommand(
      this.platform === "darwin" ? "security" : "secret-tool",
      this.platform === "darwin"
        ? ["delete-generic-password", "-a", this.account, "-s", service]
        : ["clear", "service", service, "account", this.account],
    );
  }

  private runCommand(
    command: string,
    args: string[],
    input?: string,
  ): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => (stdout += chunk));
      child.stderr.on("data", (chunk: string) => (stderr += chunk));
      child.once("error", () =>
        reject(
          new TokenStoreUnavailable("Host credential manager is unavailable"),
        ),
      );
      child.once("close", (code) =>
        resolve({ stdout, stderr, code: code ?? 1 }),
      );
      child.stdin.end(input);
    });
  }
}

function validateStoredToken(value: unknown): OAuthTokenSet {
  if (!value || typeof value !== "object") {
    throw new Error("invalid token record");
  }
  const token = value as Record<string, unknown>;
  if (
    typeof token.accessToken !== "string" ||
    token.accessToken.length === 0 ||
    token.tokenType !== "Bearer" ||
    typeof token.expiresAt !== "number" ||
    !Number.isFinite(token.expiresAt) ||
    (token.refreshToken !== undefined &&
      typeof token.refreshToken !== "string") ||
    (token.scope !== undefined && typeof token.scope !== "string") ||
    (token.idToken !== undefined && typeof token.idToken !== "string")
  ) {
    throw new Error("invalid token record");
  }
  return token as unknown as OAuthTokenSet;
}

function quoteSecurityArgument(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function parseChunkCount(manifest: string): number | null {
  const count = Number(manifest.slice(CHUNK_MANIFEST_PREFIX.length));
  return Number.isInteger(count) && count > 0 && count <= MAX_CHUNKS
    ? count
    : null;
}
