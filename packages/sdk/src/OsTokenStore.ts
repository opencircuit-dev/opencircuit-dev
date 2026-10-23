import { spawn } from "node:child_process";

import type { OAuthTokenSet, SecureTokenStore } from "./AuthManager.js";

export class TokenStoreUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenStoreUnavailable";
  }
}

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
    const result = await this.runLookup();
    if (!result) return null;
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
    const result = await this.runClear();
    if (
      result.code !== 0 &&
      !/not found|could not be found|no such item/i.test(result.stderr)
    ) {
      throw new TokenStoreUnavailable(
        "Host credential manager could not clear OAuth credentials",
      );
    }
  }

  private async runLookup(): Promise<string | null> {
    const result = await this.runCommand(
      this.platform === "darwin" ? "security" : "secret-tool",
      this.platform === "darwin"
        ? [
            "find-generic-password",
            "-a",
            this.account,
            "-s",
            this.service,
            "-w",
          ]
        : ["lookup", "service", this.service, "account", this.account],
    );
    if (result.code !== 0) {
      if (/not found|could not be found|no such item/i.test(result.stderr)) {
        return null;
      }
      throw new TokenStoreUnavailable("Host credential manager is unavailable");
    }
    return result.stdout.trim() || null;
  }

  private runStore(value: string): Promise<CommandResult> {
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
        ? [
            "add-generic-password",
            "-U",
            "-a",
            this.account,
            "-s",
            this.service,
            "-w",
          ]
        : [
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

  private runClear(): Promise<CommandResult> {
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
        ? ["delete-generic-password", "-a", this.account, "-s", this.service]
        : ["clear", "service", this.service, "account", this.account],
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
