import { fileURLToPath, pathToFileURL } from "node:url";

import type {
  SessionState,
  SessionSummary,
  Snapshot,
} from "@opencircuit/ahp-protocol-host";

export interface CoreSessionMetadata {
  sessionId: string;
  title: string;
  dateCreated: string;
  workspaceDirectory: string;
}

export interface CoreSession {
  sessionId: string;
  revision?: number;
  title: string;
  workspaceDirectory: string;
  history: unknown[];
}

export interface CoreHistoryStore {
  create(options: {
    idempotencyKey: string;
    proposedSessionId: string;
    title?: string;
    workspaceDirectory: string;
  }): { session: CoreSession; metadata: CoreSessionMetadata };
  list(options: { limit?: number }): CoreSessionMetadata[];
  load(sessionId: string): CoreSession;
  delete(sessionId: string): void;
}

export interface CreateSessionInput {
  sessionId: string;
  provider: string;
  title?: string;
  workingDirectory?: string;
}

export interface SessionBackend {
  list(): Promise<SessionSummary[]>;
  create(
    input: CreateSessionInput,
    idempotencyKey: string,
  ): Promise<SessionSummary>;
  snapshot(resource: string): Promise<Snapshot>;
  dispose(resource: string): Promise<void>;
}

function toDirectoryUri(directory: string): string {
  if (directory.startsWith("file://")) return directory;
  return pathToFileURL(directory).toString();
}

function toDirectoryPath(directory: string | undefined): string {
  if (!directory) return process.cwd();
  if (directory.startsWith("file://")) return fileURLToPath(directory);
  return directory;
}

function timestampToIso(timestamp: string): string {
  const date = new Date(Number(timestamp));
  return Number.isNaN(date.getTime())
    ? new Date(0).toISOString()
    : date.toISOString();
}

function summaryFromMetadata(metadata: CoreSessionMetadata): SessionSummary {
  const resource = `ahp-session:/${metadata.sessionId}`;
  return {
    resource,
    provider: "opencircuit",
    title: metadata.title,
    status: 1,
    workingDirectories: [toDirectoryUri(metadata.workspaceDirectory)],
    createdAt: timestampToIso(metadata.dateCreated),
    modifiedAt: timestampToIso(metadata.dateCreated),
  };
}

function stateFromSummary(summary: SessionSummary): SessionState {
  return {
    ...summary,
    lifecycle: "ready" as SessionState["lifecycle"],
    activeClients: [],
    chats: [],
  };
}

/** Adapts Core's existing durable history manager without creating a second store. */
export class CoreHistorySessionBackend implements SessionBackend {
  constructor(private readonly store: CoreHistoryStore) {}

  async list(): Promise<SessionSummary[]> {
    return this.store.list({}).map(summaryFromMetadata);
  }

  async create(
    input: CreateSessionInput,
    idempotencyKey: string,
  ): Promise<SessionSummary> {
    const result = this.store.create({
      idempotencyKey,
      proposedSessionId: input.sessionId,
      title: input.title,
      workspaceDirectory: toDirectoryPath(input.workingDirectory),
    });
    return summaryFromMetadata(result.metadata);
  }

  async snapshot(resource: string): Promise<Snapshot> {
    const sessionId = sessionIdFromResource(resource);
    const session = this.store.load(sessionId);
    const metadata = this.store
      .list({})
      .find((item) => item.sessionId === sessionId);
    const summary = summaryFromMetadata({
      sessionId: session.sessionId,
      title: session.title,
      dateCreated: metadata?.dateCreated ?? String(Date.now()),
      workspaceDirectory: session.workspaceDirectory,
    });
    return { resource, state: stateFromSummary(summary), fromSeq: 0 };
  }

  async dispose(resource: string): Promise<void> {
    this.store.delete(sessionIdFromResource(resource));
  }
}

export function sessionIdFromResource(resource: string): string {
  const match =
    /^ahp-session:\/([0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.exec(
      resource,
    );
  if (!match) throw new Error("Invalid AHP session channel");
  return match[1];
}

/** Deterministic backend for protocol tests and the teaching smoke client. */
export class InMemorySessionBackend implements SessionBackend {
  private readonly sessions = new Map<string, SessionSummary>();

  async list(): Promise<SessionSummary[]> {
    return [...this.sessions.values()];
  }

  async create(input: CreateSessionInput): Promise<SessionSummary> {
    if (this.sessions.has(input.sessionId))
      throw new Error("session already exists");
    const now = new Date().toISOString();
    const summary: SessionSummary = {
      resource: `ahp-session:/${input.sessionId}`,
      provider: input.provider,
      title: input.title ?? "New session",
      status: 1,
      workingDirectories: input.workingDirectory
        ? [input.workingDirectory]
        : undefined,
      createdAt: now,
      modifiedAt: now,
    };
    this.sessions.set(summary.resource, summary);
    return summary;
  }

  async snapshot(resource: string): Promise<Snapshot> {
    const summary = this.sessions.get(resource);
    if (!summary) throw new Error("session not found");
    return { resource, state: stateFromSummary(summary), fromSeq: 0 };
  }

  async dispose(resource: string): Promise<void> {
    if (!this.sessions.delete(resource)) throw new Error("session not found");
  }
}
