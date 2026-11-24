import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";

const sessionMocks = vi.hoisted(() => ({ fromConfig: vi.fn() }));
const historyMocks = vi.hoisted(() => ({ resolveCreateRequest: vi.fn() }));

vi.mock("core/core", () => ({ Core: class {} }));
vi.mock("core/protocol/messenger", () => ({
  InProcessMessenger: class {},
}));
vi.mock("core/util/history", () => ({ default: historyMocks }));
vi.mock("../src/IpcIde", () => ({ IpcIde: class {} }));
vi.mock("../src/CiscoCircuitSession", () => ({
  CiscoCircuitSession: { fromConfig: sessionMocks.fromConfig },
}));

import {
  NativeWorkbenchBackend,
  runNativeWorkbenchBackend,
} from "../src/NativeWorkbenchBackend";

describe("native workbench model-list contract", () => {
  beforeEach(() => {
    sessionMocks.fromConfig.mockReset().mockResolvedValue(undefined);
    historyMocks.resolveCreateRequest.mockReset();
  });

  it("returns models and bounded configuration diagnostics", async () => {
    const backend = new NativeWorkbenchBackend();
    Reflect.set(backend, "core", {
      configHandler: {
        loadConfig: async () => ({
          config: { modelsByRole: { chat: [{ title: "test-model" }] } },
          errors: [],
          configLoadInterrupted: false,
        }),
      },
    });
    const result = await backend.handlers["models.list"](null, {
      requestId: "test",
      signal: new AbortController().signal,
      emit: async () => {},
      requestHost: async () => undefined,
    });
    expect(result).toEqual({
      models: [{ id: "test-model", name: "test-model" }],
      configDiagnostic: {
        configPresent: true,
        configLoadInterrupted: false,
        configErrorCount: 0,
        chatModelCount: 1,
        configErrorCategory: "none",
        configErrorCode: "other",
        configErrorPath: "",
      },
    });
  });

  it("does not expose raw error details through diagnostics", async () => {
    const backend = new NativeWorkbenchBackend();
    Reflect.set(backend, "core", {
      configHandler: {
        loadConfig: async () => ({
          config: undefined,
          errors: [
            {
              fatal: true,
              message: "private-message",
              diagnosticCategory: "private-category",
              diagnosticCode: "private-code",
              diagnosticPath: "privatevalue",
            },
          ],
          configLoadInterrupted: true,
        }),
      },
    });
    const result = await backend.handlers["models.list"](null, {
      requestId: "test",
      signal: new AbortController().signal,
      emit: async () => {},
      requestHost: async () => undefined,
    });
    expect(result).toEqual({
      models: [],
      configDiagnostic: {
        configPresent: false,
        configLoadInterrupted: true,
        configErrorCount: 1,
        chatModelCount: 0,
        configErrorCategory: "other",
        configErrorCode: "other",
        configErrorPath: "",
      },
    });
  });

  it("preserves safe diagnostic coordinates", async () => {
    const backend = new NativeWorkbenchBackend();
    Reflect.set(backend, "core", {
      configHandler: {
        loadConfig: async () => ({
          config: undefined,
          errors: [
            {
              fatal: true,
              message: "private-message",
              diagnosticCategory: "schema_validation",
              diagnosticCode: "invalid_type",
              diagnosticPath: "models[0].roles[0]",
            },
          ],
          configLoadInterrupted: true,
        }),
      },
    });
    const result = await backend.handlers["models.list"](null, {
      requestId: "test",
      signal: new AbortController().signal,
      emit: async () => {},
      requestHost: async () => undefined,
    });
    expect(result.configDiagnostic).toEqual({
      configPresent: false,
      configLoadInterrupted: true,
      configErrorCount: 1,
      chatModelCount: 0,
      configErrorCategory: "schema_validation",
      configErrorCode: "invalid_type",
      configErrorPath: "models[0].roles[0]",
    });
  });

  it("uses policy discovery rather than the placeholder Core model", async () => {
    sessionMocks.fromConfig.mockResolvedValue({
      listModels: async () => [{ id: "policy-model", name: "Policy model" }],
    });
    const backend = new NativeWorkbenchBackend();
    Reflect.set(backend, "core", {
      configHandler: { loadConfig: vi.fn() },
    });
    const result = await backend.handlers["models.list"](null, {
      requestId: "test",
      signal: new AbortController().signal,
      emit: async () => {},
      requestHost: async () => undefined,
    });
    expect(result.models).toEqual([
      { id: "policy-model", name: "Policy model", source: "cisco-circuit" },
    ]);
    expect(result.configDiagnostic.chatModelCount).toBe(1);
  });

  it("resolves an existing create key only after workspace authorization", async () => {
    const backend = new NativeWorkbenchBackend();
    Reflect.set(backend, "core", {});
    historyMocks.resolveCreateRequest.mockReturnValue({
      sessionId: "existing",
    });
    const context = {
      requestId: "test",
      signal: new AbortController().signal,
      emit: async () => {},
      requestHost: async () => ["/test-workspace"],
    };
    const request = {
      workspaceUri: "file:///test-workspace",
      idempotencyKey: "create-key",
    };
    expect(
      await backend.handlers["chat.resolveCreate"](request, context),
    ).toEqual({ sessionId: "existing" });
    expect(historyMocks.resolveCreateRequest).toHaveBeenCalledWith(
      "create-key",
      "file:///test-workspace",
    );
    historyMocks.resolveCreateRequest.mockClear();
    await expect(
      backend.handlers["chat.resolveCreate"](
        { ...request, workspaceUri: "file:///other" },
        context,
      ),
    ).rejects.toThrow();
    expect(historyMocks.resolveCreateRequest).not.toHaveBeenCalled();
  });

  it("routes and persists the selected model for a continued Cisco session", async () => {
    const streamChat = vi.fn(async function* () {
      yield { role: "assistant", content: "answer" };
    });
    sessionMocks.fromConfig.mockResolvedValue({ streamChat });
    const backend = new NativeWorkbenchBackend();
    Reflect.set(backend, "core", {});
    const session = {
      sessionId: "session",
      chatModelTitle: "first",
      workspaceDirectory: "file:///test-workspace",
      history: [],
    };
    const externalRequest = vi.fn(async (method: string) => {
      if (method === "history/load") return session;
      if (method === "history/save") return { revision: 1 };
      throw new Error("unexpected request");
    });
    Reflect.set(backend, "messenger", {
      withContext: (_context: unknown, fn: () => unknown) => fn(),
      externalRequest,
    });
    const signal = new AbortController().signal;
    await backend.handlers["chat.runTurn"](
      {
        chat: { sessionId: "session" },
        input: {
          text: "hello",
          workspaceUri: "file:///test-workspace",
          modelId: "second",
        },
      },
      {
        requestId: "test",
        signal,
        emit: async () => {},
        requestHost: async () => ["/test-workspace"],
      },
    );
    expect(streamChat).toHaveBeenCalledWith(
      "second",
      [{ role: "user", content: "hello" }],
      signal,
      true,
    );
    expect(externalRequest).toHaveBeenCalledWith(
      "history/save",
      expect.objectContaining({
        sessionId: "session",
        chatModelTitle: "second",
      }),
      "test",
    );
  });

  it("routes a turn using the persisted session model", async () => {
    const streamChat = vi.fn(async function* () {
      yield { role: "assistant", content: "answer" };
    });
    sessionMocks.fromConfig.mockResolvedValue({ streamChat });
    const backend = new NativeWorkbenchBackend();
    Reflect.set(backend, "core", {});
    const session = {
      sessionId: "session",
      chatModelTitle: "chosen-model",
      workspaceDirectory: "file:///test-workspace",
      history: [],
    };
    const externalRequest = vi.fn(async (method: string) => {
      if (method === "history/load") return session;
      if (method === "history/save") return { revision: 1 };
      throw new Error("unexpected request");
    });
    Reflect.set(backend, "messenger", {
      withContext: (_context: unknown, fn: () => unknown) => fn(),
      externalRequest,
      invoke: vi.fn(() => {
        throw new Error("unexpected Core inference");
      }),
    });
    const events: unknown[] = [];
    const signal = new AbortController().signal;
    await backend.handlers["chat.runTurn"](
      {
        chat: { sessionId: "session" },
        input: { text: "hello", workspaceUri: "file:///test-workspace" },
      },
      {
        requestId: "test",
        signal,
        emit: async (event) => {
          events.push(event);
        },
        requestHost: async () => ["/test-workspace"],
      },
    );
    expect(streamChat).toHaveBeenCalledWith(
      "chosen-model",
      [{ role: "user", content: "hello" }],
      signal,
      true,
    );
    expect(events).toContainEqual({ type: "assistantText", text: "answer" });
    expect(externalRequest).toHaveBeenCalledWith(
      "history/save",
      expect.objectContaining({ sessionId: "session" }),
      "test",
    );
  });

  it("passes the explicitly selected non-streaming mode to Cisco", async () => {
    const streamChat = vi.fn(async function* () {
      yield { role: "assistant", content: "complete answer" };
    });
    sessionMocks.fromConfig.mockResolvedValue({ streamChat });
    const backend = new NativeWorkbenchBackend();
    Reflect.set(backend, "core", {});
    Reflect.set(backend, "messenger", {
      withContext: (_context: unknown, fn: () => unknown) => fn(),
      externalRequest: async (method: string) => {
        if (method === "history/load")
          return {
            sessionId: "session",
            chatModelTitle: "chosen-model",
            workspaceDirectory: "file:///test-workspace",
            history: [],
          };
        if (method === "history/save") return { revision: 1 };
        throw new Error("unexpected request");
      },
    });
    const events: unknown[] = [];
    const signal = new AbortController().signal;
    await backend.handlers["chat.runTurn"](
      {
        chat: { sessionId: "session" },
        input: {
          text: "hello",
          workspaceUri: "file:///test-workspace",
          stream: false,
        },
      },
      {
        requestId: "test",
        signal,
        emit: async (event) => {
          events.push(event);
        },
        requestHost: async () => ["/test-workspace"],
      },
    );
    expect(streamChat).toHaveBeenCalledWith(
      "chosen-model",
      [{ role: "user", content: "hello" }],
      signal,
      false,
    );
    expect(events).toContainEqual({
      type: "assistantText",
      text: "complete answer",
    });
    expect(events).toContainEqual({ type: "turnCompleted" });
  });

  it.each(["false", null, 0])(
    "rejects a non-boolean turn streaming option",
    async (stream) => {
      const backend = new NativeWorkbenchBackend();
      await expect(
        backend.handlers["chat.runTurn"](
          { chat: { sessionId: "session" }, input: { text: "hello", stream } },
          {
            requestId: "test",
            signal: new AbortController().signal,
            emit: async () => {},
            requestHost: async () => undefined,
          },
        ),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    },
  );

  it("rejects non-streaming mode for the generic Core path", async () => {
    const backend = new NativeWorkbenchBackend();
    Reflect.set(backend, "core", {});
    await expect(
      backend.handlers["chat.runTurn"](
        {
          chat: { sessionId: "session" },
          input: { text: "hello", stream: false },
        },
        {
          requestId: "test",
          signal: new AbortController().signal,
          emit: async () => {},
          requestHost: async () => undefined,
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("rejects a turn when its claimed workspace does not own the session", async () => {
    const streamChat = vi.fn();
    sessionMocks.fromConfig.mockResolvedValue({ streamChat });
    const backend = new NativeWorkbenchBackend();
    Reflect.set(backend, "core", {});
    Reflect.set(backend, "messenger", {
      withContext: (_context: unknown, fn: () => unknown) => fn(),
      externalRequest: async () => ({
        sessionId: "session",
        chatModelTitle: "chosen-model",
        workspaceDirectory: "file:///workspace-a",
        history: [],
      }),
    });
    await expect(
      backend.handlers["chat.runTurn"](
        {
          chat: { sessionId: "session" },
          input: { text: "hello", workspaceUri: "file:///workspace-b" },
        },
        {
          requestId: "test",
          signal: new AbortController().signal,
          emit: async () => {},
          requestHost: async () => ["/workspace-b"],
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("denies restoring or deleting a session from another workspace", async () => {
    sessionMocks.fromConfig.mockResolvedValue({});
    const backend = new NativeWorkbenchBackend();
    Reflect.set(backend, "core", {});
    const externalRequest = vi.fn(async (_method: string) => ({
      sessionId: "session",
      workspaceDirectory: "file:///workspace-a",
      history: [],
    }));
    Reflect.set(backend, "messenger", {
      withContext: (_context: unknown, fn: () => unknown) => fn(),
      externalRequest,
    });
    const context = {
      requestId: "test",
      signal: new AbortController().signal,
      emit: async () => {},
      requestHost: async () => ["/workspace-a", "/workspace-b"],
    };
    const chat = { sessionId: "session", workspaceUri: "file:///workspace-b" };
    await expect(
      backend.handlers["chat.restore"](chat, context),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      backend.handlers["chat.delete"](chat, context),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(
      externalRequest.mock.calls.every(([method]) => method === "history/load"),
    ).toBe(true);
  });

  it("requires an explicit login request and supports logout", async () => {
    const ensureAuthenticated = vi.fn();
    const logout = vi.fn().mockResolvedValue(true);
    sessionMocks.fromConfig.mockResolvedValue({ ensureAuthenticated, logout });
    const backend = new NativeWorkbenchBackend();
    const context = {
      requestId: "test",
      signal: new AbortController().signal,
      emit: async () => {},
      requestHost: async () => undefined,
    };
    await backend.handlers["auth.login"]({}, context);
    expect(ensureAuthenticated).toHaveBeenCalledWith(true);
    expect(await backend.handlers["auth.logout"]({}, context)).toEqual({
      remotelyRevoked: true,
    });
    expect(logout).toHaveBeenCalledOnce();
  });

  it("aborts active requests and rejects pending host calls on disconnect", async () => {
    const backend = new NativeWorkbenchBackend();
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let aborted = false;
    let hostRejected = false;
    backend.handlers["auth.login"] = async (_payload, context) => {
      context.signal.addEventListener("abort", () => {
        aborted = true;
      });
      const hostCall = context.requestHost("getWorkspaceDirs", null);
      started();
      try {
        await hostCall;
      } catch {
        hostRejected = true;
      }
      return {};
    };
    const input = new PassThrough();
    const output = new PassThrough();
    output.resume();
    const running = runNativeWorkbenchBackend(true, backend, input, output);
    const body = Buffer.from(
      JSON.stringify({
        protocolVersion: 1,
        kind: "request",
        requestId: randomUUID(),
        method: "auth.login",
        payload: {},
      }),
    );
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length);
    input.write(header);
    input.write(body);
    await requestStarted;
    input.end();
    await running;
    await vi.waitFor(() => {
      expect(aborted).toBe(true);
      expect(hostRejected).toBe(true);
    });
  });

  it("acknowledges a cancelled request with an event and terminal result", async () => {
    const backend = new NativeWorkbenchBackend();
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    backend.handlers["auth.login"] = async (_payload, context) => {
      started();
      await new Promise<void>((resolve) =>
        context.signal.addEventListener("abort", () => resolve(), {
          once: true,
        }),
      );
      return {};
    };
    const input = new PassThrough();
    const output = new PassThrough();
    const frames: Array<{ kind: string; payload: unknown; sequence?: number }> =
      [];
    let buffered = new Uint8Array();
    output.on("data", (chunk: Buffer) => {
      const combined = new Uint8Array(buffered.length + chunk.length);
      combined.set(buffered);
      combined.set(chunk, buffered.length);
      buffered = combined;
      while (buffered.length >= 4) {
        const length = new DataView(
          buffered.buffer,
          buffered.byteOffset,
        ).getUint32(0);
        if (buffered.length < length + 4) break;
        frames.push(
          JSON.parse(new TextDecoder().decode(buffered.slice(4, length + 4))),
        );
        buffered = buffered.slice(length + 4);
      }
    });
    const running = runNativeWorkbenchBackend(true, backend, input, output);
    const requestId = randomUUID();
    const send = (message: unknown) => {
      const body = Buffer.from(JSON.stringify(message));
      const header = Buffer.alloc(4);
      header.writeUInt32BE(body.length);
      input.write(header);
      input.write(body);
    };
    try {
      send({
        protocolVersion: 1,
        kind: "request",
        requestId,
        method: "auth.login",
        payload: {},
      });
      await requestStarted;
      send({ protocolVersion: 1, kind: "cancel", requestId });
      await vi.waitFor(() => expect(frames).toHaveLength(2));
      expect(frames).toMatchObject([
        { kind: "event", sequence: 1, payload: { type: "cancelled" } },
        { kind: "result", payload: { status: "cancelled" } },
      ]);
    } finally {
      input.end();
      await running;
    }
  });
});
