import {
  AhpErrorCodes,
  JsonRpcErrorCodes,
  negotiateProtocolVersion,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  type Snapshot,
} from "@opencircuit/ahp-protocol-host";

import type { SessionBackend } from "./backend.js";

export const ROOT_CHANNEL = "ahp-root://" as const;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification;
export type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: number | string; result: unknown }
  | {
      jsonrpc: "2.0";
      id: number | string;
      error: { code: number; message: string; data?: unknown };
    };
export type HostOutput =
  | JsonRpcResponse
  | JsonRpcNotification
  | HostOutput[]
  | null;

export interface AgentHostOptions {
  backend: SessionBackend;
  serverName?: string;
  serverVersion?: string;
}

function isRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return "id" in message;
}

function channelOf(params: unknown): string | undefined {
  return params && typeof params === "object" && "channel" in params
    ? typeof (params as { channel?: unknown }).channel === "string"
      ? (params as { channel: string }).channel
      : undefined
    : undefined;
}

function errorResponse(
  id: number | string,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

function successResponse(
  id: number | string,
  result: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

class HostProtocolError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
  }
}

function assertObject(
  value: unknown,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("params must be an object");
}

export class AgentHost {
  private initialized = false;
  private closed = false;
  private clientId = "";
  private serverSeq = 0;
  private readonly subscriptions = new Set<string>();

  constructor(private readonly options: AgentHostOptions) {}

  async handle(message: unknown): Promise<HostOutput> {
    if (this.closed) return null;
    if (!message || typeof message !== "object" || Array.isArray(message))
      return null;
    const candidate = message as Partial<JsonRpcMessage>;
    if (candidate.jsonrpc !== "2.0" || typeof candidate.method !== "string") {
      return "id" in candidate &&
        (typeof candidate.id === "string" || typeof candidate.id === "number")
        ? errorResponse(
            candidate.id,
            JsonRpcErrorCodes.InvalidRequest,
            "Invalid JSON-RPC request",
          )
        : null;
    }
    if (!isRequest(candidate as JsonRpcMessage)) {
      if (!this.initialized) return null;
      return null;
    }
    const request = candidate as JsonRpcRequest;
    try {
      const result = await this.dispatch(request);
      const response = successResponse(request.id, result);
      return this.pendingNotifications.length > 0
        ? [response, ...this.pendingNotifications.splice(0)]
        : response;
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      const errorCode =
        error && typeof error === "object" && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (
        error instanceof HostProtocolError &&
        error.code === AhpErrorCodes.UnsupportedProtocolVersion
      ) {
        this.closed = true;
      }
      const code =
        error instanceof HostProtocolError
          ? error.code
          : errorCode === "HISTORY_NOT_FOUND" ||
              (messageText.toLowerCase().includes("session") &&
                messageText.toLowerCase().includes("not found"))
            ? AhpErrorCodes.SessionNotFound
            : errorCode === "HISTORY_SESSION_ID_CONFLICT"
              ? AhpErrorCodes.SessionAlreadyExists
              : request.method === "unknown" ||
                  messageText.startsWith("method not implemented:")
                ? JsonRpcErrorCodes.MethodNotFound
                : JsonRpcErrorCodes.InvalidParams;
      return errorResponse(
        request.id,
        code,
        messageText,
        error instanceof HostProtocolError ? error.data : undefined,
      );
    }
  }

  private readonly pendingNotifications: JsonRpcNotification[] = [];

  private async dispatch(request: JsonRpcRequest): Promise<unknown> {
    if (!this.initialized && request.method !== "initialize") {
      throw new Error("initialize must be the first request");
    }

    if (request.method === "initialize") {
      if (this.initialized)
        throw new Error("initialize may only be called once");
      assertObject(request.params);
      if (
        request.params.channel !== ROOT_CHANNEL ||
        !Array.isArray(request.params.protocolVersions) ||
        typeof request.params.clientId !== "string"
      ) {
        throw new Error("invalid initialize parameters");
      }
      const offered = request.params.protocolVersions.filter(
        (version): version is string => typeof version === "string",
      );
      const selected = negotiateProtocolVersion(offered);
      if (!selected) {
        throw new HostProtocolError(
          AhpErrorCodes.UnsupportedProtocolVersion,
          "No compatible AHP protocol version was offered",
          {
            supportedVersions: [
              PROTOCOL_VERSION,
              ...SUPPORTED_PROTOCOL_VERSIONS,
            ],
          },
        );
      }
      this.initialized = true;
      this.clientId = request.params.clientId;
      const initialSubscriptions = Array.isArray(
        request.params.initialSubscriptions,
      )
        ? request.params.initialSubscriptions.filter(
            (value): value is string => typeof value === "string",
          )
        : [ROOT_CHANNEL];
      const snapshots: Snapshot[] = [];
      for (const channel of initialSubscriptions) {
        this.subscriptions.add(channel);
        snapshots.push(await this.snapshot(channel));
      }
      return {
        protocolVersion: selected,
        serverSeq: this.serverSeq,
        serverInfo: {
          name: this.options.serverName ?? "@opencircuit/agent-host",
          version: this.options.serverVersion,
        },
        snapshots,
      };
    }

    const channel = channelOf(request.params);
    if (!channel) throw new Error("every AHP command requires params.channel");

    switch (request.method) {
      case "ping":
        if (channel !== ROOT_CHANNEL)
          throw new Error("ping must target the root channel");
        return null;
      case "listSessions":
        if (channel !== ROOT_CHANNEL)
          throw new Error("listSessions must target the root channel");
        return { items: await this.options.backend.list() };
      case "subscribe":
        this.assertSupportedChannel(channel);
        this.subscriptions.add(channel);
        return { snapshot: await this.snapshot(channel) };
      case "createSession": {
        this.assertSessionChannel(channel);
        assertObject(request.params);
        const provider =
          typeof request.params.provider === "string"
            ? request.params.provider
            : "opencircuit";
        if (provider !== "opencircuit") {
          throw new HostProtocolError(
            AhpErrorCodes.ProviderNotFound,
            `No Open Circuit agent for provider ${provider}`,
          );
        }
        const summary = await this.options.backend.create(
          {
            sessionId: channel.slice("ahp-session:/".length),
            provider,
            title:
              typeof request.params.title === "string"
                ? request.params.title
                : undefined,
            workingDirectory:
              Array.isArray(request.params.workingDirectories) &&
              typeof request.params.workingDirectories[0] === "string"
                ? request.params.workingDirectories[0]
                : undefined,
          },
          `ahp:${this.clientId}:${channel.slice("ahp-session:/".length)}`,
        );
        this.pendingNotifications.push({
          jsonrpc: "2.0",
          method: "root/sessionAdded",
          params: { channel: ROOT_CHANNEL, summary },
        });
        return null;
      }
      case "disposeSession":
        this.assertSessionChannel(channel);
        await this.options.backend.dispose(channel);
        this.subscriptions.delete(channel);
        this.pendingNotifications.push({
          jsonrpc: "2.0",
          method: "root/sessionRemoved",
          params: { channel: ROOT_CHANNEL, session: channel },
        });
        return null;
      case "reconnect":
        if (channel !== ROOT_CHANNEL)
          throw new Error("reconnect must target the root channel");
        return {
          type: "snapshot",
          snapshots: await this.snapshotsForSubscriptions(),
        };
      default:
        throw new HostProtocolError(
          JsonRpcErrorCodes.MethodNotFound,
          `method not implemented: ${request.method}`,
        );
    }
  }

  private async snapshot(channel: string): Promise<Snapshot> {
    if (channel === ROOT_CHANNEL) {
      const sessions = await this.options.backend.list();
      return {
        resource: ROOT_CHANNEL,
        fromSeq: this.serverSeq,
        state: {
          agents: [
            {
              provider: "opencircuit",
              displayName: "Open Circuit",
              description: "Open Circuit Core agent",
              models: [],
            },
          ],
          activeSessions: sessions.length,
        },
      };
    }
    return this.options.backend.snapshot(channel);
  }

  private async snapshotsForSubscriptions(): Promise<Snapshot[]> {
    const snapshots: Snapshot[] = [];
    for (const channel of this.subscriptions)
      snapshots.push(await this.snapshot(channel));
    return snapshots;
  }

  private assertSupportedChannel(channel: string): void {
    if (channel === ROOT_CHANNEL || channel.startsWith("ahp-session:/")) return;
    throw new Error(`unsupported channel: ${channel}`);
  }

  private assertSessionChannel(channel: string): void {
    if (
      !/^ahp-session:\/[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        channel,
      )
    ) {
      throw new Error("invalid AHP session channel");
    }
  }
}
