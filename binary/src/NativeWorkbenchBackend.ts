import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Readable, Writable } from "node:stream";
import { TokenStoreUnavailable } from "@opencircuit/sdk";
import { Core } from "core/core";
import type { FromCoreProtocol, ToCoreProtocol } from "core/protocol";
import { InProcessMessenger } from "core/protocol/messenger";
import type { Message } from "core/protocol/messenger";
import historyManager from "core/util/history";
import { CiscoCircuitSession } from "./CiscoCircuitSession";
import { IpcIde } from "./IpcIde";

const PROTOCOL_VERSION = 1;
const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const EVENT_CREDIT_WINDOW = 16;
const MAX_REQUESTS = 256;

type WireErrorCode =
  | "INVALID_REQUEST"
  | "HISTORY_INVALID_CREATE_REQUEST"
  | "HISTORY_NOT_FOUND"
  | "HISTORY_CORRUPT"
  | "HISTORY_STORAGE"
  | "HISTORY_CREATE_IDEMPOTENCY_CONFLICT"
  | "HISTORY_SAVE_CONFLICT"
  | "CISCO_AUTH_REQUIRED"
  | "CISCO_AUTH_FAILED"
  | "CISCO_CREDENTIAL_STORE_UNAVAILABLE"
  | "CISCO_POLICY_FAILED"
  | "CISCO_MODEL_UNAVAILABLE"
  | "CISCO_NOT_CONFIGURED"
  | "INTERNAL";

interface WireRequest {
  protocolVersion: 1;
  kind: "request";
  requestId: string;
  method: string;
  payload: unknown;
}

interface WireHostResult {
  protocolVersion: 1;
  kind: "hostResult";
  requestId: string;
  callId: string;
  payload?: unknown;
  code?: WireErrorCode;
}

interface RpcContext {
  readonly requestId: string;
  readonly signal: AbortSignal;
  emit(payload: unknown): Promise<void>;
  requestHost(method: string, payload: unknown): Promise<unknown>;
}

interface ActiveRequest {
  readonly controller: AbortController;
  readonly waiters: Array<() => void>;
  credits: number;
  sequence: number;
  cancelAcknowledged: boolean;
  terminalSent: boolean;
}

interface ActiveHostCall {
  readonly requestId: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
}

function encodeFrame(message: unknown): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(message));
  if (body.length === 0 || body.length > MAX_FRAME_BYTES) {
    throw new Error("IPC frame size is invalid");
  }
  const frame = new Uint8Array(4 + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, false);
  frame.set(body, 4);
  return frame;
}

function isRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function safeCode(error: unknown): WireErrorCode {
  if (error instanceof TokenStoreUnavailable)
    return "CISCO_CREDENTIAL_STORE_UNAVAILABLE";
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  switch (code) {
    case "INVALID_REQUEST":
    case "HISTORY_INVALID_CREATE_REQUEST":
    case "HISTORY_NOT_FOUND":
    case "HISTORY_CORRUPT":
    case "HISTORY_STORAGE":
    case "HISTORY_CREATE_IDEMPOTENCY_CONFLICT":
    case "HISTORY_SAVE_CONFLICT":
    case "CISCO_AUTH_REQUIRED":
    case "CISCO_AUTH_FAILED":
    case "CISCO_POLICY_FAILED":
    case "CISCO_MODEL_UNAVAILABLE":
    case "CISCO_NOT_CONFIGURED":
      return code;
    default:
      return "INTERNAL";
  }
}

function safeMessage(code: WireErrorCode): string {
  switch (code) {
    case "INVALID_REQUEST":
      return "Invalid request";
    case "HISTORY_INVALID_CREATE_REQUEST":
      return "Invalid session request";
    case "HISTORY_NOT_FOUND":
      return "Session not found";
    case "HISTORY_CORRUPT":
      return "Session data is unreadable";
    case "HISTORY_STORAGE":
      return "Unable to access session storage";
    case "HISTORY_CREATE_IDEMPOTENCY_CONFLICT":
      return "Create request conflicts with an existing session";
    case "HISTORY_SAVE_CONFLICT":
      return "Session changed; reload and retry";
    case "CISCO_AUTH_REQUIRED":
      return "Cisco Circuit sign-in is required";
    case "CISCO_AUTH_FAILED":
      return "Cisco Circuit authentication failed";
    case "CISCO_CREDENTIAL_STORE_UNAVAILABLE":
      return "Cisco Circuit credential store is unavailable";
    case "CISCO_POLICY_FAILED":
      return "Cisco Circuit model policy could not be loaded";
    case "CISCO_MODEL_UNAVAILABLE":
      return "Cisco model is not available or entitled";
    case "CISCO_NOT_CONFIGURED":
      return "Cisco Circuit authentication is not configured";
    case "INTERNAL":
      return "Request failed";
  }
}

class BackendMessenger extends InProcessMessenger<
  ToCoreProtocol,
  FromCoreProtocol
> {
  private readonly context = new AsyncLocalStorage<RpcContext>();

  override request<T extends keyof FromCoreProtocol>(
    messageType: T,
    data: FromCoreProtocol[T][0],
  ): Promise<FromCoreProtocol[T][1]> {
    const context = this.context.getStore();
    if (!context) {
      return Promise.reject(
        new Error(
          "Core requested a host capability outside an active backend request",
        ),
      );
    }
    return context.requestHost(String(messageType), data) as Promise<
      FromCoreProtocol[T][1]
    >;
  }

  withContext<T>(context: RpcContext, fn: () => T): T {
    return this.context.run(context, fn);
  }
}

/** Core-owned history/model/chat dispatcher used only by the framed stdio process. */
export class NativeWorkbenchBackend {
  private readonly messenger = new BackendMessenger();
  private core: Core | undefined;
  private readonly sessionTurnTails = new Map<string, Promise<void>>();
  private ciscoSession: Promise<CiscoCircuitSession | undefined> | undefined;

  readonly handlers = {
    "backend/ready": async (_payload: unknown, context: RpcContext) => {
      const core = await this._core(context);
      await core.configHandler.isInitialized;
      return {
        contractVersion: 1,
        coreVersion: "1.1.0",
        capabilities: { ciscoNonStreaming: true, sessionModelSelection: true },
      };
    },
    "auth.login": async (_payload: unknown, _context: RpcContext) => {
      const session = await this._ciscoSession();
      if (!session)
        throw Object.assign(new Error(), { code: "CISCO_NOT_CONFIGURED" });
      await session.ensureAuthenticated(true);
      return {};
    },
    "auth.logout": async (_payload: unknown, _context: RpcContext) => {
      const session = await this._ciscoSession();
      if (!session)
        throw Object.assign(new Error(), { code: "CISCO_NOT_CONFIGURED" });
      return { remotelyRevoked: await session.logout() };
    },
    "models.list": async (_payload: unknown, context: RpcContext) => {
      const cisco = await this._ciscoSession();
      if (cisco) {
        const models = (await cisco.listModels()).map((model) => ({
          ...model,
          source: "cisco-circuit" as const,
        }));
        return {
          models,
          configDiagnostic: {
            configPresent: true,
            configLoadInterrupted: false,
            configErrorCount: 0,
            chatModelCount: models.length,
            configErrorCategory: "none",
            configErrorCode: "other",
            configErrorPath: "",
          },
        };
      }
      const core = await this._core(context);
      const { config, errors, configLoadInterrupted } =
        await core.configHandler.loadConfig();
      const models = (config?.modelsByRole.chat ?? []).map((model) => ({
        id: model.title,
        name: model.title,
      }));
      const fatalError = errors?.find((error) => error.fatal);
      return {
        models,
        configDiagnostic: {
          configPresent: config !== undefined,
          configLoadInterrupted: configLoadInterrupted ?? false,
          configErrorCount: errors?.length ?? 0,
          chatModelCount: models.length,
          configErrorCategory: configErrorCategory(
            configLoadInterrupted ?? false,
            fatalError?.diagnosticCategory,
            fatalError !== undefined,
          ),
          configErrorCode: configErrorCode(fatalError?.diagnosticCode),
          configErrorPath: configErrorPath(fatalError?.diagnosticPath),
        },
      };
    },
    "chat.create": async (payload: unknown, context: RpcContext) => {
      const value = asRecord(payload);
      const workspaceUri = requiredString(value.workspaceUri);
      const cisco = await this._ciscoSession();
      if (cisco) {
        await authorizeWorkspace(context, workspaceUri);
        const modelId = requiredString(value.modelId);
        if (!(await cisco.listModels()).some((model) => model.id === modelId)) {
          throw Object.assign(new Error(), { code: "CISCO_MODEL_UNAVAILABLE" });
        }
      }
      const created = await this.messenger.withContext(context, () =>
        this.messenger.externalRequest(
          "history/create",
          {
            title: optionalString(value.title),
            workspaceDirectory: workspaceUri,
            chatModelTitle: optionalString(value.modelId) ?? null,
            idempotencyKey: requiredString(value.idempotencyKey),
          },
          context.requestId,
        ),
      );
      return { sessionId: created.session.sessionId };
    },
    "chat.resolveCreate": async (payload: unknown, context: RpcContext) => {
      await this._core(context);
      const value = asRecord(payload);
      const workspaceUri = requiredString(value.workspaceUri);
      await authorizeWorkspace(context, workspaceUri);
      const session = historyManager.resolveCreateRequest(
        requiredString(value.idempotencyKey),
        workspaceUri,
      );
      return session ? { sessionId: session.sessionId } : null;
    },
    "chat.list": async (payload: unknown, context: RpcContext) => {
      await this._core(context);
      const value = asRecord(payload);
      if (await this._ciscoSession()) {
        await authorizeWorkspace(context, requiredString(value.workspaceUri));
      }
      const sessions = await this.messenger.withContext(context, () =>
        this.messenger.externalRequest(
          "history/list",
          {
            workspaceDirectory: optionalString(value.workspaceUri),
            limit: optionalNumber(value.limit),
            offset: optionalNumber(value.offset),
          },
          context.requestId,
        ),
      );
      return sessions.map((session) => ({
        sessionId: session.sessionId,
        title: session.title,
        createdAt: session.dateCreated,
        workspaceUri: session.workspaceDirectory,
        messageCount: session.messageCount ?? 0,
      }));
    },
    "chat.restore": async (payload: unknown, context: RpcContext) => {
      await this._core(context);
      const value = asRecord(payload);
      const sessionId = requiredString(value.sessionId);
      const cisco = await this._ciscoSession();
      const workspaceUri = cisco
        ? requiredString(value.workspaceUri)
        : undefined;
      if (workspaceUri) await authorizeWorkspace(context, workspaceUri);
      const session = await this.messenger.withContext(context, () =>
        this.messenger.externalRequest(
          "history/load",
          { id: sessionId },
          context.requestId,
        ),
      );
      if (workspaceUri)
        assertSessionWorkspace(session.workspaceDirectory, workspaceUri);
      const metadata = await this.messenger.withContext(context, () =>
        this.messenger.externalRequest(
          "history/list",
          { limit: 1000 } as ToCoreProtocol["history/list"][0],
          context.requestId,
        ),
      );
      const createdAt =
        metadata.find((item) => item.sessionId === sessionId)?.dateCreated ??
        "";
      return {
        sessionId: session.sessionId,
        title: session.title,
        createdAt,
        workspaceUri: session.workspaceDirectory,
        messageCount: session.history.length,
        revision: session.revision ?? 0,
        transcript: session.history.map(({ message }) => ({
          role: message.role === "tool" ? ("tool" as const) : message.role,
          content: textContent(message.content),
          ...(message.role === "tool" ? { toolName: message.toolCallId } : {}),
        })),
      };
    },
    "chat.save": async (payload: unknown, context: RpcContext) => {
      await this._core(context);
      const value = asRecord(payload);
      const chat = asRecord(value.chat);
      const snapshot = asRecord(value.snapshot);
      const sessionId = requiredString(chat.sessionId);
      const cisco = await this._ciscoSession();
      const workspaceUri = cisco
        ? requiredString(chat.workspaceUri)
        : undefined;
      if (workspaceUri) await authorizeWorkspace(context, workspaceUri);
      const session = await this.messenger.withContext(context, () =>
        this.messenger.externalRequest(
          "history/load",
          { id: sessionId },
          context.requestId,
        ),
      );
      if (workspaceUri)
        assertSessionWorkspace(session.workspaceDirectory, workspaceUri);
      const transcript = Array.isArray(snapshot.transcript)
        ? snapshot.transcript
        : [];
      const saved = await this.messenger.withContext(context, () =>
        this.messenger.externalRequest(
          "history/save",
          {
            ...session,
            revision:
              optionalNumber(snapshot.revision) ?? session.revision ?? 0,
            history: transcript.map((item) => {
              const message = asRecord(item);
              const role = message.role;
              if (role !== "user" && role !== "assistant") {
                throw Object.assign(new Error(), { code: "INVALID_REQUEST" });
              }
              return {
                message: { role, content: requiredString(message.content) },
                contextItems: [],
              };
            }),
          },
          context.requestId,
        ),
      );
      return { revision: saved.revision };
    },
    "chat.delete": async (payload: unknown, context: RpcContext) => {
      await this._core(context);
      const value = asRecord(payload);
      const sessionId = requiredString(value.sessionId);
      if (await this._ciscoSession()) {
        const workspaceUri = requiredString(value.workspaceUri);
        await authorizeWorkspace(context, workspaceUri);
        const session = await this.messenger.withContext(context, () =>
          this.messenger.externalRequest(
            "history/load",
            { id: sessionId },
            context.requestId,
          ),
        );
        assertSessionWorkspace(session.workspaceDirectory, workspaceUri);
      }
      return this.messenger.withContext(context, () =>
        this.messenger.externalRequest(
          "history/delete",
          { id: sessionId },
          context.requestId,
        ),
      );
    },
    "chat.runTurn": async (payload: unknown, context: RpcContext) =>
      this._runTurnSerialized(payload, context),
  };

  private _ciscoSession(): Promise<CiscoCircuitSession | undefined> {
    if (!this.ciscoSession) {
      this.ciscoSession = (async () => {
        const root =
          process.env.OCIRCUIT_GLOBAL_DIR ?? join(homedir(), ".ocircuit");
        const yaml = join(root, "config.yaml");
        let config = yaml;
        try {
          await lstat(yaml);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          config = join(root, "config.json");
        }
        return CiscoCircuitSession.fromConfig(
          config,
          join(homedir(), ".ocircuit", "cisco-circuit.env"),
        );
      })().catch((error: unknown) => {
        this.ciscoSession = undefined;
        throw error;
      });
    }
    return this.ciscoSession;
  }

  private async _core(context: RpcContext): Promise<Core> {
    if (this.core) {
      return this.core;
    }
    await this._ciscoSession();
    return this.messenger.withContext(context, async () => {
      if (!this.core) {
        this.core = new Core(this.messenger, new IpcIde(this.messenger));
      }
      return this.core;
    });
  }

  messengerContext<T>(context: RpcContext, fn: () => T): T {
    return this.messenger.withContext(context, fn);
  }

  private async _runTurnSerialized(
    payload: unknown,
    context: RpcContext,
  ): Promise<{ status: "completed" | "cancelled" }> {
    const value = asRecord(payload);
    const sessionId = requiredString(asRecord(value.chat).sessionId);
    const previous = this.sessionTurnTails.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.sessionTurnTails.set(sessionId, tail);
    await previous;
    try {
      return await this._runTurn(payload, context);
    } finally {
      release();
      if (this.sessionTurnTails.get(sessionId) === tail) {
        this.sessionTurnTails.delete(sessionId);
      }
    }
  }

  private async _runTurn(
    payload: unknown,
    context: RpcContext,
  ): Promise<{ status: "completed" | "cancelled" }> {
    const value = asRecord(payload);
    const chat = asRecord(value.chat);
    const input = asRecord(value.input);
    const sessionId = requiredString(chat.sessionId);
    const text = requiredString(input.text);
    if (input.stream !== undefined && typeof input.stream !== "boolean") {
      throw Object.assign(new Error(), { code: "INVALID_REQUEST" });
    }
    const core = await this._core(context);
    const cisco = await this._ciscoSession();
    if (!cisco && input.stream === false) {
      throw Object.assign(new Error(), { code: "INVALID_REQUEST" });
    }
    const workspaceUri = cisco ? requiredString(input.workspaceUri) : undefined;
    if (workspaceUri) await authorizeWorkspace(context, workspaceUri);
    const session = await this.messenger.withContext(context, () =>
      this.messenger.externalRequest(
        "history/load",
        { id: sessionId },
        context.requestId,
      ),
    );
    if (workspaceUri)
      assertSessionWorkspace(session.workspaceDirectory, workspaceUri);
    const modelId = optionalString(input.modelId);
    const userMessage = { role: "user" as const, content: text };
    const coreMessageId = context.requestId;
    const messages = [
      ...session.history.map((item) => item.message),
      userMessage,
    ];
    const abort = () =>
      cisco
        ? undefined
        : this.messenger.withContext(context, () =>
            this.messenger.invoke("abort", undefined, coreMessageId),
          );
    context.signal.addEventListener("abort", abort, { once: true });
    await context.emit({ type: "turnStarted" });
    const llmStream = cisco
      ? cisco.streamChat(
          requiredString(modelId ?? session.chatModelTitle),
          messages,
          context.signal,
          input.stream !== false,
        )
      : this.messenger.withContext(context, () =>
          this.messenger.invoke(
            "llm/streamChat",
            {
              messages,
              completionOptions: {},
              title: modelId ?? session.chatModelTitle ?? "OpenCircuit",
            },
            coreMessageId,
          ),
        );
    let assistantText = "";
    let streamError: unknown;
    try {
      let next = await llmStream.next();
      while (!next.done) {
        if (context.signal.aborted) {
          await llmStream.return(undefined as never);
          break;
        }
        const chunk = next.value;
        if (chunk.role !== "assistant") {
          throw Object.assign(new Error(), { code: "INVALID_REQUEST" });
        }
        const textChunk = textContent(chunk.content);
        assistantText += textChunk;
        await context.emit({ type: "assistantText", text: textChunk });
        next = await llmStream.next();
      }
    } catch (error) {
      streamError = error;
    } finally {
      context.signal.removeEventListener("abort", abort);
    }
    await this._persistTurn(
      sessionId,
      userMessage,
      assistantText,
      context,
      !streamError && !context.signal.aborted ? modelId : undefined,
    );
    if (context.signal.aborted) {
      return { status: "cancelled" };
    }
    if (streamError) {
      throw streamError;
    }
    await context.emit({ type: "turnCompleted" });
    return { status: "completed" };
  }

  private async _persistTurn(
    sessionId: string,
    userMessage: { role: "user"; content: string },
    assistantText: string,
    context: RpcContext,
    modelId?: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await this.messenger.withContext(context, () =>
        this.messenger.externalRequest(
          "history/load",
          { id: sessionId },
          context.requestId,
        ),
      );
      const history = [
        ...latest.history,
        { message: userMessage, contextItems: [] },
      ];
      if (assistantText) {
        history.push({
          message: { role: "assistant", content: assistantText },
          contextItems: [],
        });
      }
      try {
        await this.messenger.withContext(context, () =>
          this.messenger.externalRequest(
            "history/save",
            {
              ...latest,
              history,
              ...(modelId ? { chatModelTitle: modelId } : {}),
            },
            context.requestId,
          ),
        );
        return;
      } catch (error) {
        if (safeCode(error) !== "HISTORY_SAVE_CONFLICT" || attempt === 2) {
          throw error;
        }
      }
    }
  }
}

function workspacePath(uri: string): string {
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:" || url.host || url.search || url.hash) {
      throw new Error();
    }
    return resolve(fileURLToPath(url));
  } catch {
    throw Object.assign(new Error(), { code: "INVALID_REQUEST" });
  }
}

async function authorizeWorkspace(
  context: RpcContext,
  uri: string,
): Promise<void> {
  const requested = workspacePath(uri);
  const roots = await context.requestHost("getWorkspaceDirs", undefined);
  if (
    !Array.isArray(roots) ||
    !roots.some(
      (root) =>
        typeof root === "string" &&
        isAbsolute(root) &&
        resolve(root) === requested,
    )
  ) {
    throw Object.assign(new Error(), { code: "INVALID_REQUEST" });
  }
}

function assertSessionWorkspace(stored: string, requested: string): void {
  if (workspacePath(stored) !== workspacePath(requested)) {
    throw Object.assign(new Error(), { code: "INVALID_REQUEST" });
  }
}

function configErrorCategory(
  interrupted: boolean,
  category: string | undefined,
  hasFatalError: boolean,
): string {
  if (!interrupted) return "none";
  if (!hasFatalError) return "other";
  if (!category) return "config_resolution";
  return [
    "schema_validation",
    "model_validation",
    "config_resolution",
  ].includes(category)
    ? category
    : "other";
}

function configErrorCode(code: string | undefined): string {
  const allowedCodes = new Set([
    "invalid_type",
    "unrecognized_keys",
    "invalid_union",
    "invalid_value",
    "too_small",
    "too_big",
    "invalid_format",
    "filesystem_not_found",
    "filesystem_permission",
    "filesystem_other",
    "profile_discovery_error",
    "profile_load_error",
    "runtime_error",
  ]);
  return code && allowedCodes.has(code) ? code : "other";
}

function configErrorPath(path: string | undefined): string {
  if (!path || path.length > 160) return "";
  const allowedParts = new Set([
    "name",
    "version",
    "schema",
    "metadata",
    "models",
    "provider",
    "model",
    "apiBase",
    "apiKey",
    "roles",
    "capabilities",
    "contextLength",
    "maxStopWords",
    "defaultCompletionOptions",
    "cacheBehavior",
    "requestOptions",
    "headers",
    "embedOptions",
    "chatOptions",
    "disableTools",
    "baseSystemMessage",
    "baseAgentSystemMessage",
    "basePlanSystemMessage",
    "toolOverrides",
    "promptTemplates",
    "useLegacyCompletionsEndpoint",
    "useResponsesApi",
    "env",
    "autocompleteOptions",
    "field",
    "ide_info",
    "ide_identity",
    "ide_settings",
    "config_paths",
    "yaml_loader",
    "json_loader",
    "rules_loader",
    "post_load_selected_models",
    "post_load_mcp_status",
    "post_load_config_tools",
    "post_load",
    "yaml_local_blocks",
    "yaml_unroll",
    "yaml_runtime_conversion",
    "prompt_files",
    "context_providers",
    "json_mcp",
    "mcp_registration",
    "yaml_shared_merge",
  ]);
  if (!/^[A-Za-z0-9_.\[\]]+$/.test(path)) return "";
  return path.split(".").every((part) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(?:0|[1-9]\d*)\])*$/.exec(
      part,
    );
    return match !== null && allowedParts.has(match[1]);
  })
    ? path
    : "";
}

export async function runNativeWorkbenchBackend(
  helloAlreadySent = false,
  backend = new NativeWorkbenchBackend(),
  input: Readable = process.stdin,
  outputStream: Writable = process.stdout,
): Promise<void> {
  const decoder = new FrameDecoder();
  const active = new Map<string, ActiveRequest>();
  const hostCalls = new Map<string, ActiveHostCall>();
  let connected = true;
  const output = (message: unknown) =>
    new Promise<void>((resolve, reject) => {
      outputStream.write(encodeFrame(message), (error) =>
        error ? reject(error) : resolve(),
      );
    });
  const failProtocol = () => {
    input.destroy();
    outputStream.end();
  };
  const acknowledgeCancelled = async (
    requestId: string,
    request: ActiveRequest,
  ) => {
    if (!connected || request.cancelAcknowledged) return;
    request.cancelAcknowledged = true;
    request.terminalSent = true;
    request.sequence++;
    await output({
      protocolVersion: PROTOCOL_VERSION,
      kind: "event",
      requestId,
      sequence: request.sequence,
      payload: { type: "cancelled" },
    });
    await output({
      protocolVersion: PROTOCOL_VERSION,
      kind: "result",
      requestId,
      payload: { status: "cancelled" },
    });
  };
  if (!helloAlreadySent) {
    await output({
      protocolVersion: PROTOCOL_VERSION,
      kind: "hello",
      requestId: randomUUID(),
    });
  }
  input.on("data", (chunk: Buffer) => {
    let messages: unknown[];
    try {
      messages = decoder.push(new Uint8Array(chunk));
    } catch {
      failProtocol();
      return;
    }
    for (const raw of messages) {
      const message = asRecord(raw);
      if (
        message.protocolVersion !== PROTOCOL_VERSION ||
        !isRequestId(message.requestId)
      ) {
        failProtocol();
        return;
      }
      const requestId = message.requestId;
      if (message.kind === "cancel") {
        const request = active.get(requestId);
        if (request && !request.terminalSent) {
          request.controller.abort();
          request.waiters.splice(0).forEach((resolve) => resolve());
        }
      } else if (message.kind === "credit") {
        const request = active.get(requestId);
        if (
          !Number.isSafeInteger(message.credits) ||
          Number(message.credits) <= 0
        ) {
          failProtocol();
          return;
        }
        // A fast request may complete after the client writes its request but before
        // the following initial-credit frame is read. Late credit is harmless.
        if (!request) {
          continue;
        }
        if (request.credits + Number(message.credits) > EVENT_CREDIT_WINDOW) {
          failProtocol();
          return;
        }
        request.credits += Number(message.credits);
        request.waiters.splice(0).forEach((resolve) => resolve());
      } else if (message.kind === "hostResult") {
        const callId = String(message.callId);
        const call = hostCalls.get(callId);
        if (!call || call.requestId !== requestId) {
          failProtocol();
          return;
        }
        hostCalls.delete(callId);
        if (typeof message.code === "string") {
          call.reject(
            Object.assign(new Error("Host capability failed"), {
              code: message.code,
            }),
          );
        } else {
          call.resolve(message.payload);
        }
      } else if (message.kind === "request") {
        if (
          active.size >= MAX_REQUESTS ||
          !isRequestId(requestId) ||
          typeof message.method !== "string" ||
          typeof message.payload === "undefined" ||
          active.has(requestId)
        ) {
          failProtocol();
          return;
        }
        const request: ActiveRequest = {
          controller: new AbortController(),
          waiters: [],
          credits: 0,
          sequence: 0,
          cancelAcknowledged: false,
          terminalSent: false,
        };
        active.set(requestId, request);
        const handler = Object.hasOwn(backend.handlers, message.method)
          ? backend.handlers[message.method as keyof typeof backend.handlers]
          : undefined;
        void (async () => {
          try {
            if (!handler) {
              throw Object.assign(new Error(), { code: "INVALID_REQUEST" });
            }
            const context: RpcContext = {
              requestId,
              signal: request.controller.signal,
              emit: async (payload) => {
                while (
                  request.credits === 0 &&
                  !request.controller.signal.aborted
                ) {
                  await new Promise<void>((resolve) =>
                    request.waiters.push(resolve),
                  );
                }
                if (request.controller.signal.aborted) {
                  throw new Error("Cancelled");
                }
                request.credits--;
                request.sequence++;
                await output({
                  protocolVersion: PROTOCOL_VERSION,
                  kind: "event",
                  requestId,
                  sequence: request.sequence,
                  payload,
                });
              },
              requestHost: async (method, payload) => {
                const callId = randomUUID();
                const hostRequestId = randomUUID();
                if (hostCalls.size >= 64) {
                  throw Object.assign(new Error(), { code: "INTERNAL" });
                }
                let resolve!: (value: unknown) => void;
                let reject!: (error: Error) => void;
                const result = new Promise<unknown>((res, rej) => {
                  resolve = res;
                  reject = rej;
                });
                // A disconnect can reject this while the host request is still being written.
                void result.catch(() => undefined);
                hostCalls.set(callId, {
                  requestId: hostRequestId,
                  resolve,
                  reject,
                });
                try {
                  await output({
                    protocolVersion: PROTOCOL_VERSION,
                    kind: "hostRequest",
                    requestId: hostRequestId,
                    callId,
                    method,
                    payload: payload === undefined ? null : payload,
                  });
                  return await result;
                } finally {
                  hostCalls.delete(callId);
                }
              },
            };
            const result = await backend.messengerContext(context, () =>
              handler(message.payload, context),
            );
            if (request.controller.signal.aborted) {
              await acknowledgeCancelled(requestId, request);
            } else {
              request.terminalSent = true;
              await output({
                protocolVersion: PROTOCOL_VERSION,
                kind: "result",
                requestId,
                payload: result === undefined ? null : result,
              });
            }
          } catch (error) {
            const code = safeCode(error);
            if (request.controller.signal.aborted) {
              await acknowledgeCancelled(requestId, request);
            } else {
              request.terminalSent = true;
              await output({
                protocolVersion: PROTOCOL_VERSION,
                kind: "error",
                requestId,
                code,
                message: safeMessage(code),
                retryable:
                  code === "INTERNAL" || code === "HISTORY_SAVE_CONFLICT",
              });
            }
          } finally {
            active.delete(requestId);
          }
        })().catch(failProtocol);
      } else {
        failProtocol();
        return;
      }
    }
  });
  await new Promise<void>((resolve) => {
    input.once("end", resolve);
    input.once("close", resolve);
  });
  connected = false;
  for (const request of active.values()) {
    request.controller.abort();
    request.waiters.splice(0).forEach((resolve) => resolve());
  }
  for (const call of hostCalls.values()) {
    call.reject(new Error("Native host disconnected"));
  }
  active.clear();
  hostCalls.clear();
}

class FrameDecoder {
  private buffer = new Uint8Array(0);

  push(chunk: Uint8Array): unknown[] {
    if (this.buffer.length) {
      const combined = new Uint8Array(this.buffer.length + chunk.length);
      combined.set(this.buffer);
      combined.set(chunk, this.buffer.length);
      this.buffer = combined;
    } else {
      this.buffer = new Uint8Array(chunk);
    }
    const messages: unknown[] = [];
    while (this.buffer.length >= 4) {
      const length = new DataView(
        this.buffer.buffer,
        this.buffer.byteOffset,
        this.buffer.byteLength,
      ).getUint32(0, false);
      if (length === 0 || length > MAX_FRAME_BYTES) {
        throw new Error("Bad frame length");
      }
      if (this.buffer.length < length + 4) {
        break;
      }
      const json = new TextDecoder("utf-8", { fatal: true }).decode(
        this.buffer.subarray(4, length + 4),
      );
      messages.push(JSON.parse(json));
      this.buffer = this.buffer.slice(length + 4);
    }
    return messages;
  }
}

function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(), { code: "INVALID_REQUEST" });
  }
  return value as Record<string, any>;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") {
    throw Object.assign(new Error(), { code: "INVALID_REQUEST" });
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requiredString(value);
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw Object.assign(new Error(), { code: "INVALID_REQUEST" });
  }
  return Number(value);
}

function textContent(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .filter(
        (item) =>
          item &&
          typeof item === "object" &&
          (item as { type?: unknown }).type === "text",
      )
      .map((item) => String((item as { text?: unknown }).text ?? ""))
      .join("");
  }
  throw Object.assign(new Error(), { code: "HISTORY_CORRUPT" });
}
