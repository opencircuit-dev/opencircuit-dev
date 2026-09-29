import * as fs from "fs";
import * as path from "path";

import { v4 as uuidv4 } from "uuid";

import { BaseSessionMetadata, Session } from "../index.js";

import { NEW_SESSION_TITLE } from "./constants.js";
import { getSessionsFolderPath, getSessionsListPath } from "./paths.js";

import type {
  CreateSessionOptions,
  CreatedSession,
  ListHistoryOptions,
} from "../protocol/core.js";

type PersistedSession = Session & { creationRequestId?: string };

export type SessionHistoryErrorCode =
  | "HISTORY_NOT_FOUND"
  | "HISTORY_CORRUPT"
  | "HISTORY_STORAGE"
  | "HISTORY_CREATE_IDEMPOTENCY_CONFLICT";

export class SessionHistoryError extends Error {
  constructor(
    readonly code: SessionHistoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SessionHistoryError";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return (
    !!error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  );
}

function isSession(value: unknown): value is PersistedSession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<PersistedSession>;
  return (
    typeof candidate.sessionId === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.workspaceDirectory === "string" &&
    Array.isArray(candidate.history)
  );
}

function assistantMessageCount(session: Session): number {
  return session.history.filter((item) => item?.message?.role === "assistant")
    .length;
}

function metadataFromSession(
  session: Session,
  dateCreated: string,
): BaseSessionMetadata {
  return {
    sessionId: session.sessionId,
    title: session.title,
    dateCreated,
    workspaceDirectory: session.workspaceDirectory,
    messageCount: assistantMessageCount(session),
  };
}

function writeFileAtomically(
  filePath: string,
  contents: string,
  exclusive: boolean,
): void {
  const directory = path.dirname(filePath);
  const tempPath = path.join(
    directory,
    `.${path.basename(filePath)}.${uuidv4()}.tmp`,
  );
  let fd: number | undefined;
  try {
    fd = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(fd, contents, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;

    if (exclusive) {
      // linkSync publishes the fully written file atomically and refuses to
      // replace a destination that already exists.
      fs.linkSync(tempPath, filePath);
      fs.unlinkSync(tempPath);
    } else {
      fs.renameSync(tempPath, filePath);
    }

    try {
      const dirFd = fs.openSync(directory, "r");
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch {
      // Some supported filesystems do not allow fsync on directories.
    }
  } finally {
    if (fd !== undefined) {
      fs.closeSync(fd);
    }
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
  }
}

export class HistoryManager {
  private sessionPath(sessionId: string): string {
    if (
      !sessionId ||
      sessionId.includes("\0") ||
      sessionId.includes("/") ||
      sessionId.includes("\\")
    ) {
      throw new SessionHistoryError(
        "HISTORY_NOT_FOUND",
        "The OpenCircuit session ID is invalid",
      );
    }
    const folder = getSessionsFolderPath();
    const sessionFile = path.resolve(folder, `${sessionId}.json`);
    const relativePath = path.relative(folder, sessionFile);
    if (
      relativePath === ".." ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath)
    ) {
      throw new SessionHistoryError(
        "HISTORY_NOT_FOUND",
        "The OpenCircuit session ID is invalid",
      );
    }
    return sessionFile;
  }

  private readSessionsList(): BaseSessionMetadata[] {
    const filepath = getSessionsListPath();
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(filepath, "utf8"));
      if (!Array.isArray(parsed)) {
        throw new Error("Session list must be a JSON array");
      }
      return parsed.filter(
        (item): item is BaseSessionMetadata =>
          !!item &&
          typeof item === "object" &&
          typeof item.sessionId === "string" &&
          typeof item.title === "string" &&
          typeof item.dateCreated === "string" &&
          typeof item.workspaceDirectory === "string",
      );
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      if (error instanceof SyntaxError) {
        // The list is a rebuildable index; session records are canonical.
        return [];
      }
      throw new SessionHistoryError(
        "HISTORY_STORAGE",
        "Unable to read the OpenCircuit session index",
        { cause: error },
      );
    }
  }

  private writeSessionsList(sessions: BaseSessionMetadata[]): void {
    const filepath = getSessionsListPath();
    try {
      writeFileAtomically(
        filepath,
        JSON.stringify(sessions, undefined, 2),
        false,
      );
    } catch (error) {
      throw new SessionHistoryError(
        "HISTORY_STORAGE",
        "Unable to write the OpenCircuit session index",
        { cause: error },
      );
    }
  }

  /** Rebuilds missing index rows from canonical session records after a crash. */
  private reconcileSessionsList(): BaseSessionMetadata[] {
    const folder = getSessionsFolderPath();
    const previous = this.readSessionsList();
    const previousById = new Map(
      previous.map((item) => [item.sessionId, item]),
    );
    const files = fs
      .readdirSync(folder)
      .filter((name) => name.endsWith(".json") && name !== "sessions.json");
    const records = new Map<string, BaseSessionMetadata>();

    for (const file of files) {
      const sessionId = file.slice(0, -".json".length);
      const filePath = path.join(folder, file);
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (!isSession(parsed) || parsed.sessionId !== sessionId) {
          const known = previousById.get(sessionId);
          if (known) {
            records.set(sessionId, known);
          }
          continue;
        }
        const oldMetadata = previousById.get(sessionId);
        const stat = fs.statSync(filePath);
        const dateCreated =
          oldMetadata?.dateCreated ??
          String(Math.trunc(stat.birthtimeMs || stat.mtimeMs));
        records.set(sessionId, metadataFromSession(parsed, dateCreated));
      } catch (error) {
        if (error instanceof SyntaxError) {
          const known = previousById.get(sessionId);
          if (known) {
            records.set(sessionId, known);
          }
          continue;
        }
        if (isNodeError(error) && error.code === "ENOENT") {
          continue;
        }
        throw new SessionHistoryError(
          "HISTORY_STORAGE",
          "Unable to reconcile OpenCircuit session records",
          { cause: error },
        );
      }
    }

    const previousOrder = previous
      .map((item) => records.get(item.sessionId))
      .filter((item): item is BaseSessionMetadata => !!item);
    const knownIds = new Set(previousOrder.map((item) => item.sessionId));
    const recovered = Array.from(records.values())
      .filter((item) => !knownIds.has(item.sessionId))
      .sort((a, b) => Number(a.dateCreated) - Number(b.dateCreated));
    const reconciled = [...previousOrder, ...recovered];
    if (JSON.stringify(previous) !== JSON.stringify(reconciled)) {
      this.writeSessionsList(reconciled);
    }
    return reconciled;
  }

  private readPersistedSession(sessionId: string): PersistedSession {
    const sessionFile = this.sessionPath(sessionId);
    let contents: string;
    try {
      contents = fs.readFileSync(sessionFile, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new SessionHistoryError(
          "HISTORY_NOT_FOUND",
          `OpenCircuit session ${sessionId} was not found`,
          { cause: error },
        );
      }
      throw new SessionHistoryError(
        "HISTORY_STORAGE",
        `Unable to read OpenCircuit session ${sessionId}`,
        { cause: error },
      );
    }

    try {
      const parsed: unknown = JSON.parse(contents);
      if (!isSession(parsed) || parsed.sessionId !== sessionId) {
        throw new Error("Session record has an invalid shape or identity");
      }
      return parsed;
    } catch (error) {
      throw new SessionHistoryError(
        "HISTORY_CORRUPT",
        `OpenCircuit session ${sessionId} is corrupt`,
        { cause: error },
      );
    }
  }

  private publicSession(session: PersistedSession): Session {
    const { creationRequestId: _creationRequestId, ...publicData } = session;
    return publicData;
  }

  private findByIdempotencyKey(
    idempotencyKey: string,
  ): PersistedSession | undefined {
    const folder = getSessionsFolderPath();
    const files = fs
      .readdirSync(folder)
      .filter((name) => name.endsWith(".json") && name !== "sessions.json");
    for (const file of files) {
      try {
        const parsed: unknown = JSON.parse(
          fs.readFileSync(path.join(folder, file), "utf8"),
        );
        if (isSession(parsed) && parsed.creationRequestId === idempotencyKey) {
          return parsed;
        }
      } catch (error) {
        if (
          !(error instanceof SyntaxError) &&
          !(isNodeError(error) && error.code === "ENOENT")
        ) {
          throw new SessionHistoryError(
            "HISTORY_STORAGE",
            "Unable to inspect OpenCircuit session records for a create retry",
            { cause: error },
          );
        }
      }
    }
    return undefined;
  }

  create(options: CreateSessionOptions): CreatedSession {
    if (!options.idempotencyKey || options.idempotencyKey.length > 256) {
      throw new SessionHistoryError(
        "HISTORY_CREATE_IDEMPOTENCY_CONFLICT",
        "A non-empty idempotency key of at most 256 characters is required",
      );
    }
    if (typeof options.workspaceDirectory !== "string") {
      throw new SessionHistoryError(
        "HISTORY_STORAGE",
        "A workspace identity is required to create an OpenCircuit session",
      );
    }

    const existing = this.findByIdempotencyKey(options.idempotencyKey);
    if (existing) {
      const requestedTitle = options.title?.trim() || NEW_SESSION_TITLE;
      if (
        existing.title !== requestedTitle ||
        existing.workspaceDirectory !== options.workspaceDirectory ||
        existing.chatModelTitle !== options.chatModelTitle
      ) {
        throw new SessionHistoryError(
          "HISTORY_CREATE_IDEMPOTENCY_CONFLICT",
          "The idempotency key was already used with different session metadata",
        );
      }
      const metadata = this.reconcileSessionsList().find(
        (item) => item.sessionId === existing.sessionId,
      );
      if (!metadata) {
        throw new SessionHistoryError(
          "HISTORY_STORAGE",
          "The retried OpenCircuit create could not be reconciled",
        );
      }
      return { session: this.publicSession(existing), metadata };
    }

    const session: Session = {
      sessionId: "",
      title: options.title?.trim() || NEW_SESSION_TITLE,
      workspaceDirectory: options.workspaceDirectory,
      history: [],
    };
    if (options.chatModelTitle !== undefined) {
      session.chatModelTitle = options.chatModelTitle;
    }
    let persisted: PersistedSession | undefined;
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        session.sessionId = uuidv4();
        persisted = {
          ...session,
          creationRequestId: options.idempotencyKey,
        };
        try {
          writeFileAtomically(
            this.sessionPath(session.sessionId),
            JSON.stringify(persisted, undefined, 2),
            true,
          );
          break;
        } catch (error) {
          if (isNodeError(error) && error.code === "EEXIST") {
            persisted = undefined;
            continue;
          }
          throw error;
        }
      }
      if (!persisted) {
        throw new SessionHistoryError(
          "HISTORY_STORAGE",
          "Unable to allocate a unique OpenCircuit session ID",
        );
      }
      const metadata = metadataFromSession(session, String(Date.now()));
      const sessions = this.reconcileSessionsList();
      const indexedMetadata = sessions.find(
        (item) => item.sessionId === session.sessionId,
      );
      if (!indexedMetadata) {
        this.writeSessionsList([...sessions, metadata]);
      }
      return { session, metadata: indexedMetadata ?? metadata };
    } catch (error) {
      if (error instanceof SessionHistoryError) {
        throw error;
      }
      throw new SessionHistoryError(
        "HISTORY_STORAGE",
        "Unable to create an OpenCircuit session",
        { cause: error },
      );
    }
  }

  list(options: ListHistoryOptions): BaseSessionMetadata[] {
    let sessions = this.reconcileSessionsList()
      .filter((session) => typeof (session as any).session_id !== "string")
      .reverse();

    if (options.workspaceDirectory) {
      const target = options.workspaceDirectory.toLowerCase();
      sessions = sessions.filter(
        (session) => session.workspaceDirectory.toLowerCase() === target,
      );
    }
    if (options.limit !== undefined) {
      const offset = options.offset ?? 0;
      sessions = sessions.slice(offset, offset + options.limit);
    }
    return sessions;
  }

  delete(sessionId: string): void {
    const sessionFile = this.sessionPath(sessionId);
    try {
      fs.unlinkSync(sessionFile);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw new SessionHistoryError(
          "HISTORY_NOT_FOUND",
          `OpenCircuit session ${sessionId} was not found`,
          { cause: error },
        );
      }
      throw new SessionHistoryError(
        "HISTORY_STORAGE",
        `Unable to delete OpenCircuit session ${sessionId}`,
        { cause: error },
      );
    }
    this.reconcileSessionsList();
  }

  clearAll(): void {
    fs.rmSync(getSessionsFolderPath(), { recursive: true, force: true });
  }

  load(sessionId: string): Session {
    return this.publicSession(this.readPersistedSession(sessionId));
  }

  save(session: Session): void {
    if (!session.sessionId || !Array.isArray(session.history)) {
      throw new SessionHistoryError(
        "HISTORY_CORRUPT",
        "The OpenCircuit session to save is invalid",
      );
    }
    let creationRequestId: string | undefined;
    try {
      const previous = this.readPersistedSession(session.sessionId);
      creationRequestId = previous.creationRequestId;
    } catch (error) {
      if (
        !(error instanceof SessionHistoryError) ||
        error.code !== "HISTORY_NOT_FOUND"
      ) {
        throw error;
      }
    }
    const persisted: PersistedSession = {
      ...session,
      ...(creationRequestId ? { creationRequestId } : {}),
    };
    try {
      writeFileAtomically(
        this.sessionPath(session.sessionId),
        JSON.stringify(persisted, undefined, 2),
        false,
      );
      this.reconcileSessionsList();
    } catch (error) {
      if (error instanceof SessionHistoryError) {
        throw error;
      }
      throw new SessionHistoryError(
        "HISTORY_STORAGE",
        `Unable to save OpenCircuit session ${session.sessionId}`,
        { cause: error },
      );
    }
  }
}

const historyManager = new HistoryManager();

export default historyManager;
