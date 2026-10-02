import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { Core } from "core/core";
import type { FromCoreProtocol, ToCoreProtocol } from "core/protocol";
import { InProcessMessenger } from "core/protocol/messenger";
import type { Message } from "core/protocol/messenger";
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
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code: unknown }).code
      : undefined;
  switch (code) {
    case "HISTORY_INVALID_CREATE_REQUEST":
    case "HISTORY_NOT_FOUND":
    case "HISTORY_CORRUPT":
    case "HISTORY_STORAGE":
    case "HISTORY_CREATE_IDEMPOTENCY_CONFLICT":
    case "HISTORY_SAVE_CONFLICT":
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

  readonly handlers = {
    "backend/ready": async (_payload: unknown, context: RpcContext) => {
      const core = await this._core(context);
      await core.configHandler.isInitialized;
      return { contractVersion: 1, coreVersion: "1.1.0" };
    },
    "models.list": async (_payload: unknown, context: RpcContext) => {
      const core = await this._core(context);
      const { config } = await core.configHandler.loadConfig();
      return (config?.modelsByRole.chat ?? []).map((model) => ({
        id: model.title,
        name: model.title,
      }));
    },
    "chat.create": async (payload: unknown, context: RpcContext) => {
      const value = asRecord(payload);
      const created = await this.messenger.withContext(context, () =>
        this.messenger.externalRequest(
          "history/create",
          {
            title: optionalString(value.title),
            workspaceDirectory: requiredString(value.workspaceUri),
            chatModelTitle: optionalString(value.modelId) ?? null,
            idempotencyKey: requiredString(value.idempotencyKey),
          },
          context.requestId,
        ),
      );
      return { sessionId: created.session.sessionId };
    },
    "chat.list": async (payload: unknown, context: RpcContext) => {
      await this._core(context);
      const value = asRecord(payload);
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
      const sessionId = requiredString(asRecord(payload).sessionId);
      const session = await this.messenger.withContext(context, () =>
        this.messenger.externalRequest(
          "history/load",
          { id: sessionId },
          context.requestId,
        ),
      );
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
      const session = await this.messenger.withContext(context, () =>
        this.messenger.externalRequest(
          "history/load",
          { id: sessionId },
          context.requestId,
        ),
      );
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
      const sessionId = requiredString(asRecord(payload).sessionId);
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

  private async _core(context: RpcContext): Promise<Core> {
    if (this.core) {
      return this.core;
    }
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
    const core = await this._core(context);
    const session = await this.messenger.withContext(context, () =>
      this.messenger.externalRequest(
        "history/load",
        { id: sessionId },
        context.requestId,
      ),
    );
    const userMessage = { role: "user" as const, content: text };
    const coreMessageId = context.requestId;
    const messages = [
      ...session.history.map((item) => item.message),
      userMessage,
    ];
    const abort = () =>
      this.messenger.withContext(context, () =>
        this.messenger.invoke("abort", undefined, coreMessageId),
      );
    context.signal.addEventListener("abort", abort, { once: true });
    await context.emit({ type: "turnStarted" });
    const llmStream = this.messenger.withContext(context, () =>
      this.messenger.invoke(
        "llm/streamChat",
        {
          messages,
          completionOptions: {},
          title: session.chatModelTitle ?? "OpenCircuit",
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
    await this._persistTurn(sessionId, userMessage, assistantText, context);
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
            { ...latest, history },
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

export async function runNativeWorkbenchBackend(
  helloAlreadySent = false,
): Promise<void> {
  const backend = new NativeWorkbenchBackend();
  const decoder = new FrameDecoder();
  const active = new Map<string, ActiveRequest>();
  const hostCalls = new Map<string, ActiveHostCall>();
  const output = (message: unknown) =>
    new Promise<void>((resolve, reject) => {
      process.stdout.write(encodeFrame(message), (error) =>
        error ? reject(error) : resolve(),
      );
    });
  const failProtocol = () => {
    process.stdin.destroy();
    process.stdout.end();
  };
  if (!helloAlreadySent) {
    await output({
      protocolVersion: PROTOCOL_VERSION,
      kind: "hello",
      requestId: randomUUID(),
    });
  }
  process.stdin.on("data", (chunk: Buffer) => {
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
        active.delete(requestId);
        request?.controller.abort();
        request?.waiters.splice(0).forEach((resolve) => resolve());
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
            if (!request.controller.signal.aborted) {
              await output({
                protocolVersion: PROTOCOL_VERSION,
                kind: "result",
                requestId,
                payload: result === undefined ? null : result,
              });
            }
          } catch (error) {
            const code = safeCode(error);
            if (!request.controller.signal.aborted) {
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
    process.stdin.once("end", resolve);
    process.stdin.once("close", resolve);
  });
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
