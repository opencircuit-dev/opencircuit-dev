import { lstat, open } from "node:fs/promises";

import {
  authOptionsSchema,
  type AuthOptions,
  type ConfigJson,
} from "@opencircuit/config-types";
import {
  CiscoCircuitGateway,
  resolveCiscoCircuitAuth,
} from "@opencircuit/openai-adapters";
import {
  createOAuthTokenStore,
  OpenCircuitClient,
  TokenStoreUnavailable,
} from "@opencircuit/sdk";
import type { ChatMessage } from "core";
import {
  fromChatCompletionChunk,
  toChatBody,
} from "core/llm/openaiTypeConverters";
import YAML from "yaml";

export class CiscoCircuitSession {
  private readonly client: OpenCircuitClient;
  private readonly config: ConfigJson;
  private readonly activeTokenReads = new Set<Promise<string | null>>();
  private loginInFlight: Promise<unknown> | undefined;
  private logoutInFlight: Promise<boolean> | undefined;
  private signingOut = false;
  readonly gateway: CiscoCircuitGateway;

  static async fromConfig(
    configPath: string,
    defaultProfilePath: string,
  ): Promise<CiscoCircuitSession | undefined> {
    let file;
    try {
      file = await open(configPath, "r");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        try {
          await lstat(configPath);
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === "ENOENT")
            return undefined;
          throw statError;
        }
      }
      throw error;
    }
    let contents: Buffer;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 1024 * 1024) {
        throw new Error("OpenCircuit configuration is not a suitable file");
      }
      contents = await file.readFile();
      if (contents.byteLength > 1024 * 1024) {
        throw new Error("OpenCircuit configuration is too large");
      }
    } finally {
      await file.close();
    }
    if (
      !contents.toString("utf8").trim() &&
      (await lstat(configPath)).isSymbolicLink()
    ) {
      throw new Error("Linked OpenCircuit configuration is empty");
    }
    const raw: unknown = YAML.parse(contents.toString("utf8"));
    if (!raw || typeof raw !== "object" || !("auth" in raw)) return undefined;
    const auth = authOptionsSchema.parse(raw.auth);
    if (!auth.enabled || auth.profile !== "cisco-circuit") return undefined;
    return new CiscoCircuitSession(auth, defaultProfilePath);
  }

  constructor(auth: AuthOptions, defaultProfilePath: string) {
    if (!auth.enabled || auth.profile !== "cisco-circuit") {
      throw new Error("Cisco Circuit authentication is not configured");
    }
    const resolved = authOptionsSchema.parse(
      resolveCiscoCircuitAuth(auth, undefined, defaultProfilePath),
    );
    this.config = { auth: resolved } as ConfigJson;
    this.client = new OpenCircuitClient({
      tokenStore: createOAuthTokenStore(resolved),
    });
    this.client.configureAuth(this.config);
    this.gateway = new CiscoCircuitGateway(
      () => this.getAccessToken(),
      resolved,
    );
  }

  async ensureAuthenticated(interactive: boolean): Promise<void> {
    try {
      if (await this.getAccessToken()) return;
    } catch (error) {
      if (
        !interactive ||
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "CISCO_AUTH_FAILED"
      )
        throw error;
    }
    if (!interactive) {
      throw authRequired();
    }
    if (this.signingOut) throw authRequired();
    const login = (this.loginInFlight ??= this.client.authenticate(
      this.config,
    ));
    try {
      await login;
    } catch (error) {
      if (error instanceof TokenStoreUnavailable) throw error;
      throw authFailed();
    } finally {
      if (this.loginInFlight === login) this.loginInFlight = undefined;
    }
    if (!(await this.getAccessToken())) {
      throw authFailed();
    }
  }

  async listModels(): Promise<Array<{ id: string; name: string }>> {
    await this.ensureAuthenticated(false);
    const policy = await this.getPolicy();
    return policy.models
      .filter((entry) => entry.available !== false)
      .map((entry) => ({ id: entry.id, name: entry.name ?? entry.id }));
  }

  async *streamChat(
    model: string,
    messages: ChatMessage[],
    signal: AbortSignal,
    stream = true,
  ): AsyncGenerator<ChatMessage> {
    signal.throwIfAborted();
    await waitForTurn(() => this.ensureAuthenticated(false), signal);
    signal.throwIfAborted();
    const policy = await waitForTurn(() => this.getPolicy(), signal);
    signal.throwIfAborted();
    const selected = policy.models.find((entry) => entry.id === model);
    if (!selected || selected.available === false) {
      throw Object.assign(
        new Error("Cisco model is not available or entitled"),
        {
          code: "CISCO_MODEL_UNAVAILABLE",
        },
      );
    }
    const api = this.gateway.createLlmApi(model);
    if (!stream) {
      const completion = await waitForTurn(
        () =>
          api.chatCompletionNonStream(
            { ...toChatBody(messages, { model }), stream: false },
            signal,
          ),
        signal,
      );
      const message = completion.choices[0]?.message;
      if (
        !message ||
        message.role !== "assistant" ||
        typeof message.content !== "string" ||
        message.tool_calls?.length ||
        message.function_call
      ) {
        throw new Error("Unsupported Cisco completion response");
      }
      yield { role: "assistant", content: message.content };
      return;
    }
    const body = { ...toChatBody(messages, { model }), stream: true as const };
    for await (const chunk of api.chatCompletionStream(body, signal)) {
      const message = fromChatCompletionChunk(chunk);
      if (message) yield message;
    }
  }

  private async getPolicy() {
    try {
      return await this.gateway.getPolicy();
    } catch (error) {
      if (
        error instanceof TokenStoreUnavailable ||
        (error &&
          typeof error === "object" &&
          "code" in error &&
          (error.code === "CISCO_AUTH_FAILED" ||
            error.code === "CISCO_AUTH_REQUIRED"))
      )
        throw error;
      throw Object.assign(
        new Error("Cisco Circuit model policy could not be loaded"),
        {
          code: "CISCO_POLICY_FAILED",
        },
      );
    }
  }

  private async getAccessToken() {
    if (this.signingOut) throw authRequired();
    const pending = this.client.getAccessToken();
    this.activeTokenReads.add(pending);
    try {
      return await pending;
    } catch (error) {
      if (error instanceof TokenStoreUnavailable) throw error;
      throw authFailed();
    } finally {
      this.activeTokenReads.delete(pending);
    }
  }

  async logout(): Promise<boolean> {
    if (this.logoutInFlight) return this.logoutInFlight;
    this.signingOut = true;
    this.gateway.clearPolicyCache();
    const pending = (async () => {
      try {
        await Promise.allSettled([
          ...this.activeTokenReads,
          ...(this.loginInFlight ? [this.loginInFlight] : []),
        ]);
        return await this.client.logout();
      } finally {
        this.gateway.clearPolicyCache();
      }
    })();
    this.logoutInFlight = pending;
    try {
      return await pending;
    } finally {
      this.logoutInFlight = undefined;
      this.signingOut = false;
    }
  }
}

async function waitForTurn<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation(), cancelled]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function authRequired(): Error & { code: "CISCO_AUTH_REQUIRED" } {
  return Object.assign(new Error("Cisco Circuit sign-in is required"), {
    code: "CISCO_AUTH_REQUIRED" as const,
  });
}

function authFailed(): Error & { code: "CISCO_AUTH_FAILED" } {
  return Object.assign(new Error("Cisco Circuit authentication failed"), {
    code: "CISCO_AUTH_FAILED" as const,
  });
}
