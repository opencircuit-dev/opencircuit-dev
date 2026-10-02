import { createHash } from "crypto";
import fs from "fs";
import * as os from "os";
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
import type { FromCoreProtocol, ToCoreProtocol } from "../protocol/index.js";
import type { IMessenger } from "../protocol/messenger/index.js";

type PersistedSession = Session & {
  creationRequestId?: string;
  creationRequestHash?: string;
  revision?: number;
};

export type SessionHistoryErrorCode =
  | "HISTORY_NOT_FOUND"
  | "HISTORY_CORRUPT"
  | "HISTORY_STORAGE"
  | "HISTORY_INVALID_CREATE_REQUEST"
  | "HISTORY_CREATE_IDEMPOTENCY_CONFLICT"
  | "HISTORY_SAVE_CONFLICT";

interface FileLock {
  path: string;
  token: string;
}

interface CreateLockRecord {
  host: string;
  pid: number;
  token: string;
}

const CREATE_LOCK_TIMEOUT_MS = 15_000;
const CREATE_LOCK_RETRY_MS = 10;
const MAX_IDEMPOTENCY_KEY_BYTES = 256;
const MAX_WORKSPACE_DIRECTORY_BYTES = 4096;
const MAX_SESSION_TITLE_BYTES = 512;
const MAX_CHAT_MODEL_TITLE_BYTES = 512;

function idempotencyDigest(idempotencyKey: string): string {
  return createHash("sha256").update(idempotencyKey, "utf8").digest("hex");
}

function createLockPath(idempotencyKey: string): string {
  return path.join(
    getSessionsFolderPath(),
    `.history-create-${idempotencyDigest(idempotencyKey)}.lock`,
  );
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(isNodeError(error) && error.code === "ESRCH");
  }
}

function removeStaleLock(lockPath: string): boolean {
  let contents: string;
  let originalStat: fs.Stats;
  try {
    contents = fs.readFileSync(lockPath, "utf8");
    originalStat = fs.statSync(lockPath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return true;
    }
    throw new SessionHistoryError(
      "HISTORY_STORAGE",
      "Unable to inspect an OpenCircuit create lock",
      { cause: error },
    );
  }

  let lock: CreateLockRecord;
  try {
    const parsed: unknown = JSON.parse(contents);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Create lock must be an object");
    }
    lock = parsed as CreateLockRecord;
  } catch (error) {
    throw new SessionHistoryError(
      "HISTORY_STORAGE",
      "An OpenCircuit create lock is corrupt",
      { cause: error },
    );
  }
  if (
    !lock.host ||
    typeof lock.host !== "string" ||
    !Number.isSafeInteger(lock.pid) ||
    lock.pid <= 0 ||
    typeof lock.token !== "string" ||
    !lock.token
  ) {
    throw new SessionHistoryError(
      "HISTORY_STORAGE",
      "An OpenCircuit create lock is invalid",
    );
  }
  if (lock.host !== os.hostname()) {
    return false;
  }
  if (processIsAlive(lock.pid)) {
    return false;
  }

  try {
    const currentContents = fs.readFileSync(lockPath, "utf8");
    const currentStat = fs.statSync(lockPath);
    if (
      currentContents === contents &&
      currentStat.dev === originalStat.dev &&
      currentStat.ino === originalStat.ino
    ) {
      fs.unlinkSync(lockPath);
    }
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) {
      throw new SessionHistoryError(
        "HISTORY_STORAGE",
        "Unable to clear a stale OpenCircuit create lock",
        { cause: error },
      );
    }
  }
  return true;
}

function acquireFileLock(lockPath: string, timeoutMessage: string): FileLock {
  const deadline = Date.now() + CREATE_LOCK_TIMEOUT_MS;
  const waitArray = new Int32Array(new SharedArrayBuffer(4));

  while (Date.now() < deadline) {
    const token = uuidv4();
    const tempPath = path.join(
      path.dirname(lockPath),
      `.${path.basename(lockPath)}.${token}.tmp`,
    );
    let fd: number | undefined;
    let alreadyExists = false;
    try {
      fd = fs.openSync(tempPath, "wx", 0o600);
      fs.writeFileSync(
        fd,
        JSON.stringify({ host: os.hostname(), pid: process.pid, token }),
      );
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.linkSync(tempPath, lockPath);
      return { path: lockPath, token };
    } catch (error) {
      if (isNodeError(error) && error.code === "EEXIST") {
        alreadyExists = true;
      } else {
        throw new SessionHistoryError(
          "HISTORY_STORAGE",
          "Unable to acquire an OpenCircuit create lock",
          { cause: error },
        );
      }
    } finally {
      if (fd !== undefined) {
        fs.closeSync(fd);
      }
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    }

    if (!alreadyExists) {
      continue;
    }
    if (removeStaleLock(lockPath)) {
      continue;
    }
    Atomics.wait(waitArray, 0, 0, CREATE_LOCK_RETRY_MS);
  }

  throw new SessionHistoryError("HISTORY_STORAGE", timeoutMessage);
}

function acquireCreateLock(idempotencyKey: string): FileLock {
  return acquireFileLock(
    createLockPath(idempotencyKey),
    "Timed out waiting for an OpenCircuit create request with the same idempotency key",
  );
}

function acquireSessionsIndexLock(): FileLock {
  return acquireFileLock(
    path.join(getSessionsFolderPath(), ".history-sessions-index.lock"),
    "Timed out waiting to reconcile the OpenCircuit session index",
  );
}

function acquireSessionSaveLock(sessionId: string): FileLock {
  const digest = createHash("sha256").update(sessionId, "utf8").digest("hex");
  return acquireFileLock(
    path.join(getSessionsFolderPath(), `.history-save-${digest}.lock`),
    "Timed out waiting to save an OpenCircuit session",
  );
}

function releaseFileLock(lock: FileLock): void {
  try {
    const record = JSON.parse(
      fs.readFileSync(lock.path, "utf8"),
    ) as CreateLockRecord;
    if (record.token === lock.token) {
      fs.unlinkSync(lock.path);
    }
  } catch (error) {
    if (!(isNodeError(error) && error.code === "ENOENT")) {
      throw new SessionHistoryError(
        "HISTORY_STORAGE",
        "Unable to release an OpenCircuit create lock",
        { cause: error },
      );
    }
  }
}

function validateCreateOptions(options: unknown): CreateSessionOptions {
  const invalid = () =>
    new SessionHistoryError(
      "HISTORY_INVALID_CREATE_REQUEST",
      "The OpenCircuit create request is invalid",
    );
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw invalid();
  }
  const candidate = options as Partial<CreateSessionOptions>;
  if (
    typeof candidate.idempotencyKey !== "string" ||
    candidate.idempotencyKey.trim().length === 0 ||
    Buffer.byteLength(candidate.idempotencyKey, "utf8") >
      MAX_IDEMPOTENCY_KEY_BYTES ||
    typeof candidate.workspaceDirectory !== "string" ||
    Buffer.byteLength(candidate.workspaceDirectory, "utf8") >
      MAX_WORKSPACE_DIRECTORY_BYTES ||
    (candidate.title !== undefined &&
      (typeof candidate.title !== "string" ||
        Buffer.byteLength(candidate.title, "utf8") >
          MAX_SESSION_TITLE_BYTES)) ||
    (candidate.chatModelTitle !== undefined &&
      candidate.chatModelTitle !== null &&
      (typeof candidate.chatModelTitle !== "string" ||
        Buffer.byteLength(candidate.chatModelTitle, "utf8") >
          MAX_CHAT_MODEL_TITLE_BYTES))
  ) {
    throw invalid();
  }
  return candidate as CreateSessionOptions;
}

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
    Array.isArray(candidate.history) &&
    (candidate.revision === undefined ||
      (Number.isSafeInteger(candidate.revision) && candidate.revision >= 0))
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
    const lock = acquireSessionsIndexLock();
    try {
      return this.reconcileSessionsListWithLock();
    } finally {
      releaseFileLock(lock);
    }
  }

  private reconcileSessionsListWithLock(): BaseSessionMetadata[] {
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
    const {
      creationRequestId: _creationRequestId,
      creationRequestHash: _creationRequestHash,
      ...publicData
    } = session;
    return { ...publicData, revision: session.revision ?? 0 };
  }

  private findByIdempotencyKey(
    idempotencyKey: string,
  ): PersistedSession | undefined {
    const requestHash = idempotencyDigest(idempotencyKey);
    const folder = getSessionsFolderPath();
    const files = fs
      .readdirSync(folder)
      .filter((name) => name.endsWith(".json") && name !== "sessions.json");
    for (const file of files) {
      try {
        const parsed: unknown = JSON.parse(
          fs.readFileSync(path.join(folder, file), "utf8"),
        );
        if (
          isSession(parsed) &&
          (parsed.creationRequestHash === requestHash ||
            parsed.creationRequestId === idempotencyKey)
        ) {
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
    const validatedOptions = validateCreateOptions(options);
    const lock = acquireCreateLock(validatedOptions.idempotencyKey);
    try {
      return this.createWithLock(validatedOptions);
    } finally {
      releaseFileLock(lock);
    }
  }

  private createWithLock(options: CreateSessionOptions): CreatedSession {
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
      revision: 0,
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
          creationRequestHash: idempotencyDigest(options.idempotencyKey),
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
      const sessions = this.reconcileSessionsList();
      const indexedMetadata = sessions.find(
        (item) => item.sessionId === session.sessionId,
      );
      if (!indexedMetadata) {
        throw new SessionHistoryError(
          "HISTORY_STORAGE",
          "The created OpenCircuit session could not be reconciled",
        );
      }
      return { session, metadata: indexedMetadata };
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
    const lock = acquireSessionSaveLock(sessionId);
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
    } finally {
      releaseFileLock(lock);
    }
    this.reconcileSessionsList();
  }

  clearAll(): void {
    fs.rmSync(getSessionsFolderPath(), { recursive: true, force: true });
  }

  load(sessionId: string): Session {
    return this.publicSession(this.readPersistedSession(sessionId));
  }

  save(session: Session): { revision: number } {
    if (
      !session.sessionId ||
      !Array.isArray(session.history) ||
      (session.revision !== undefined &&
        (!Number.isSafeInteger(session.revision) || session.revision < 0))
    ) {
      throw new SessionHistoryError(
        "HISTORY_CORRUPT",
        "The OpenCircuit session to save is invalid",
      );
    }
    const lock = acquireSessionSaveLock(session.sessionId);
    try {
      let previous: PersistedSession | undefined;
      try {
        previous = this.readPersistedSession(session.sessionId);
      } catch (error) {
        if (
          !(error instanceof SessionHistoryError) ||
          error.code !== "HISTORY_NOT_FOUND"
        ) {
          throw error;
        }
      }
      const expectedRevision = session.revision ?? 0;
      const actualRevision = previous?.revision ?? 0;
      if (previous && expectedRevision !== actualRevision) {
        throw new SessionHistoryError(
          "HISTORY_SAVE_CONFLICT",
          "The OpenCircuit session changed since it was loaded; reload before saving",
        );
      }
      const revision = actualRevision + 1;
      const persisted: PersistedSession = {
        ...session,
        revision,
        ...(previous?.creationRequestId
          ? { creationRequestId: previous.creationRequestId }
          : {}),
        ...(previous?.creationRequestHash
          ? { creationRequestHash: previous.creationRequestHash }
          : {}),
      };
      writeFileAtomically(
        this.sessionPath(session.sessionId),
        JSON.stringify(persisted, undefined, 2),
        false,
      );
      this.reconcileSessionsList();
      return { revision };
    } catch (error) {
      if (error instanceof SessionHistoryError) {
        throw error;
      }
      throw new SessionHistoryError(
        "HISTORY_STORAGE",
        `Unable to save OpenCircuit session ${session.sessionId}`,
        { cause: error },
      );
    } finally {
      releaseFileLock(lock);
    }
  }
}

const historyManager = new HistoryManager();

export function registerHistoryCreateHandler(
  messenger: Pick<IMessenger<ToCoreProtocol, FromCoreProtocol>, "on">,
  manager: Pick<HistoryManager, "create"> = historyManager,
): void {
  messenger.on("history/create", (message) => manager.create(message.data));
}

export function registerHistorySaveHandler(
  messenger: Pick<IMessenger<ToCoreProtocol, FromCoreProtocol>, "on">,
  manager: HistoryManager = historyManager,
): void {
  messenger.on("history/save", (message) => manager.save(message.data));
}

export default historyManager;
