import { createHash } from "crypto";
import fs from "fs";
import * as os from "os";

import { v4 as uuidv4 } from "uuid";

import { Session } from "..";
import { FromCoreProtocol, ToCoreProtocol } from "../protocol";
import { InProcessMessenger } from "../protocol/messenger";

import historyManager, {
  HistoryManager,
  registerHistoryCreateHandler,
  registerHistorySaveHandler,
  SessionHistoryError,
} from "./history";
import {
  getSessionFilePath,
  getSessionsFolderPath,
  getSessionsListPath,
} from "./paths";

const sessionId = uuidv4();
const testSession: Session = {
  history: [],
  title: `${sessionId} title`,
  workspaceDirectory: "workspaceDir",
  sessionId: sessionId,
};

function expectHistoryError(
  callback: () => unknown,
  expectedCode: string,
): void {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(SessionHistoryError);
    expect((error as SessionHistoryError).code).toBe(expectedCode);
    return;
  }
  throw new Error(`Expected SessionHistoryError with code ${expectedCode}`);
}

describe("No sessions have been created", () => {
  const testSessionId = "invalid";

  test("Listing all sessions returns empty list", () => {
    const sessions = historyManager.list({});
    expect(sessions).toEqual([]);
  });

  test("Deleting a missing session returns a typed not-found error", () => {
    try {
      historyManager.delete(testSessionId);
      throw new Error("Expected missing session delete to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SessionHistoryError);
      expect((error as SessionHistoryError).code).toBe("HISTORY_NOT_FOUND");
    }
  });

  test("Loading a missing session returns a typed not-found error", () => {
    try {
      historyManager.load(testSessionId);
      throw new Error("Expected missing session to fail to load");
    } catch (error) {
      expect(error).toBeInstanceOf(SessionHistoryError);
      expect((error as SessionHistoryError).code).toBe("HISTORY_NOT_FOUND");
    }
  });
});

describe("Full session lifecycle", () => {
  test("Creating and listing a session", () => {
    // save and list
    historyManager.save(testSession);
    const sessions = historyManager.list({});
    const sessionExists = sessions.some(
      (session) => session?.sessionId === testSession.sessionId,
    );
    expect(sessionExists).toBe(true);
  });

  test("Loading session by ID returns correct object", () => {
    const retrievedSession = historyManager.load(testSession.sessionId);
    expect(retrievedSession).toEqual({ ...testSession, revision: 1 });
  });

  test("Saving session with new title updates session", () => {
    const modifiedSession = historyManager.load(testSession.sessionId);
    modifiedSession.title = `Edited: ${testSession.title}`;
    const saved = historyManager.save(modifiedSession);
    const session = historyManager.load(testSession.sessionId);

    expect(session.title).toBe(modifiedSession.title);
    expect(saved.revision).toBe(2);
    expect(session.revision).toBe(2);
  });

  test("Rejects a stale save instead of overwriting a newer transcript", () => {
    const firstClient = historyManager.load(testSession.sessionId);
    const secondClient = historyManager.load(testSession.sessionId);
    firstClient.title = "First client";
    secondClient.title = "Second client";

    historyManager.save(firstClient);
    expectHistoryError(
      () => historyManager.save(secondClient),
      "HISTORY_SAVE_CONFLICT",
    );
    expect(historyManager.load(testSession.sessionId).title).toBe(
      "First client",
    );
  });

  test("Deleting session", () => {
    historyManager.delete(testSession.sessionId);
    const sessions = historyManager.list({});
    const sessionWasDeleted = sessions.every(
      (session) => session?.sessionId !== testSession.sessionId,
    );
    expect(sessionWasDeleted).toEqual(true);
  });
});

describe("Explicit Core session creation", () => {
  beforeEach(() => {
    historyManager.clearAll();
  });

  afterAll(() => {
    historyManager.clearAll();
  });

  const options = {
    title: "Native Chat session",
    workspaceDirectory: "/workspace/project",
    chatModelTitle: "test-model",
    idempotencyKey: "native-chat-create-request-1",
  };

  test("Core creates and lists an empty session with a generated ID", () => {
    const created = historyManager.create(options);

    expect(created.session.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created.session).toMatchObject({
      title: options.title,
      workspaceDirectory: options.workspaceDirectory,
      chatModelTitle: options.chatModelTitle,
      history: [],
    });
    expect(created.metadata.sessionId).toBe(created.session.sessionId);
    expect(historyManager.list({})[0]).toEqual(created.metadata);
    expect(historyManager.load(created.session.sessionId)).toEqual(
      created.session,
    );
    const persisted = JSON.parse(
      fs.readFileSync(getSessionFilePath(created.session.sessionId), "utf8"),
    );
    expect(persisted.creationRequestHash).toBe(
      createHash("sha256").update(options.idempotencyKey, "utf8").digest("hex"),
    );
    expect(persisted.creationRequestId).toBeUndefined();
    expect(created.session).not.toHaveProperty("creationRequestHash");
  });

  test("Core's registered messenger handler round-trips JSON request and response", async () => {
    const manager = new HistoryManager();
    const messenger = new InProcessMessenger<
      ToCoreProtocol,
      FromCoreProtocol
    >();
    registerHistoryCreateHandler(messenger, manager);

    const request = JSON.parse(JSON.stringify(options));
    const response = await messenger.externalRequest("history/create", request);
    const wireResponse = JSON.parse(JSON.stringify(response));

    expect(wireResponse.session.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(wireResponse.session.history).toEqual([]);
    expect(manager.list({})).toHaveLength(1);
    expect(manager.load(wireResponse.session.sessionId)).toEqual(
      wireResponse.session,
    );
    expectHistoryError(
      () =>
        messenger.externalRequest("history/create", {
          ...request,
          idempotencyKey: "",
        }),
      "HISTORY_INVALID_CREATE_REQUEST",
    );
  });

  test("Core's registered save handler returns revisions and rejects stale clients", async () => {
    const manager = new HistoryManager();
    const created = manager.create({
      ...options,
      idempotencyKey: "messenger-save",
    });
    const firstClient = manager.load(created.session.sessionId);
    const staleClient = manager.load(created.session.sessionId);
    const messenger = new InProcessMessenger<
      ToCoreProtocol,
      FromCoreProtocol
    >();
    registerHistorySaveHandler(messenger, manager);

    const result = await messenger.externalRequest(
      "history/save",
      JSON.parse(JSON.stringify(firstClient)),
    );
    expect(JSON.parse(JSON.stringify(result))).toEqual({ revision: 1 });
    expectHistoryError(
      () => messenger.externalRequest("history/save", staleClient),
      "HISTORY_SAVE_CONFLICT",
    );
  });

  test("Runtime validation rejects malformed and oversized create requests", () => {
    const invalidRequests: unknown[] = [
      null,
      [],
      { ...options, idempotencyKey: "   " },
      { ...options, idempotencyKey: "x".repeat(257) },
      { ...options, idempotencyKey: "😀".repeat(65) },
      { ...options, workspaceDirectory: 42 },
      { ...options, title: "x".repeat(513) },
      { ...options, chatModelTitle: 42 },
    ];

    for (const request of invalidRequests) {
      try {
        historyManager.create(request as any);
        throw new Error("Expected malformed create request to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(SessionHistoryError);
        expect((error as SessionHistoryError).code).toBe(
          "HISTORY_INVALID_CREATE_REQUEST",
        );
      }
    }
    expect(historyManager.list({})).toEqual([]);
  });

  test("Repeating an idempotency key returns the original session", () => {
    const first = historyManager.create(options);
    const retry = new HistoryManager().create(options);

    expect(retry).toEqual(first);
    expect(historyManager.list({})).toHaveLength(1);
  });

  test("A retry repairs the list index after an interrupted create", () => {
    const first = historyManager.create(options);
    fs.unlinkSync(getSessionsListPath());

    const retry = historyManager.create(options);

    expect(retry.session.sessionId).toBe(first.session.sessionId);
    expect(historyManager.list({})).toHaveLength(1);
  });

  test("A retry recovers a stale lock left by a crashed process", () => {
    const lockPath = `${getSessionsFolderPath()}/.history-create-${createHash(
      "sha256",
    )
      .update(options.idempotencyKey, "utf8")
      .digest("hex")}.lock`;
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        host: os.hostname(),
        pid: 2_000_000_000,
        token: "stale",
      }),
      { mode: 0o600 },
    );

    const created = historyManager.create(options);

    expect(created.session.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(historyManager.list({})).toHaveLength(1);
  });

  test("Session-file failure leaves no ghost session and permits retry", () => {
    const realLinkSync = fs.linkSync;
    const linkSpy = jest
      .spyOn(fs, "linkSync")
      .mockImplementation((source, destination) => {
        const destinationPath = String(destination);
        if (
          destinationPath.endsWith(".json") &&
          !destinationPath.endsWith("sessions.json")
        ) {
          throw Object.assign(new Error("simulated session write failure"), {
            code: "EIO",
          });
        }
        return realLinkSync(source, destination);
      });

    try {
      expectHistoryError(
        () => historyManager.create(options),
        "HISTORY_STORAGE",
      );
    } finally {
      linkSpy.mockRestore();
    }

    expect(historyManager.list({})).toEqual([]);
    const retry = historyManager.create(options);
    expect(historyManager.list({})).toEqual([retry.metadata]);
  });

  test("Index failure leaves a durable session that retry reconciles", () => {
    const sessionsListPath = getSessionsListPath();
    const realRenameSync = fs.renameSync;
    const renameSpy = jest
      .spyOn(fs, "renameSync")
      .mockImplementation((source, destination) => {
        if (String(destination) === sessionsListPath) {
          throw Object.assign(new Error("simulated index write failure"), {
            code: "EIO",
          });
        }
        return realRenameSync(source, destination);
      });

    try {
      expectHistoryError(
        () => historyManager.create(options),
        "HISTORY_STORAGE",
      );
    } finally {
      renameSpy.mockRestore();
    }

    const sessionFiles = fs
      .readdirSync(getSessionsFolderPath())
      .filter((name) => /^[0-9a-f-]{36}\.json$/i.test(name));
    expect(sessionFiles).toHaveLength(1);
    const retry = historyManager.create(options);
    expect(historyManager.list({})).toEqual([retry.metadata]);
  });

  test("Different idempotency keys create different sessions", () => {
    const first = historyManager.create(options);
    const second = historyManager.create({
      ...options,
      idempotencyKey: "native-chat-create-request-2",
    });

    expect(second.session.sessionId).not.toBe(first.session.sessionId);
    expect(historyManager.list({})).toHaveLength(2);
  });

  test("Reusing an idempotency key with different metadata is rejected", () => {
    historyManager.create(options);
    try {
      historyManager.create({ ...options, title: "Different title" });
      throw new Error("Expected idempotency metadata conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(SessionHistoryError);
      expect((error as SessionHistoryError).code).toBe(
        "HISTORY_CREATE_IDEMPOTENCY_CONFLICT",
      );
    }
  });

  test("Corrupt session records return a typed error", () => {
    const created = historyManager.create(options);
    fs.writeFileSync(getSessionFilePath(created.session.sessionId), "{invalid");

    try {
      historyManager.load(created.session.sessionId);
      throw new Error("Expected corrupt session to fail to load");
    } catch (error) {
      expect(error).toBeInstanceOf(SessionHistoryError);
      expect((error as SessionHistoryError).code).toBe("HISTORY_CORRUPT");
    }
  });
});

describe("Workspace directory filtering", () => {
  beforeAll(() => {
    historyManager.clearAll();
    historyManager.save({
      history: [],
      title: "Project A session 1",
      workspaceDirectory: "/home/user/project-a",
      sessionId: "ws-a-1",
    });
    historyManager.save({
      history: [],
      title: "Project B session 1",
      workspaceDirectory: "/home/user/project-b",
      sessionId: "ws-b-1",
    });
    historyManager.save({
      history: [],
      title: "Project A session 2",
      workspaceDirectory: "/home/user/project-a",
      sessionId: "ws-a-2",
    });
    historyManager.save({
      history: [],
      title: "No workspace",
      workspaceDirectory: "",
      sessionId: "ws-none",
    });
  });

  afterAll(() => {
    historyManager.clearAll();
  });

  test("Filter sessions by workspace directory", () => {
    const sessions = historyManager.list({
      workspaceDirectory: "/home/user/project-a",
    });
    expect(sessions.length).toBe(2);
    expect(
      sessions.every((s) => s.workspaceDirectory === "/home/user/project-a"),
    ).toBe(true);
  });

  test("Omitting workspace returns all sessions", () => {
    const sessions = historyManager.list({});
    expect(sessions.length).toBe(4);
  });

  test("Workspace filter is case-insensitive", () => {
    const sessions = historyManager.list({
      workspaceDirectory: "/HOME/USER/PROJECT-A",
    });
    expect(sessions.length).toBe(2);
  });

  test("Non-matching workspace returns empty list", () => {
    const sessions = historyManager.list({
      workspaceDirectory: "/home/user/nonexistent",
    });
    expect(sessions.length).toBe(0);
  });

  test("Workspace filter works with limit", () => {
    const sessions = historyManager.list({
      workspaceDirectory: "/home/user/project-a",
      limit: 1,
    });
    expect(sessions.length).toBe(1);
  });

  test("Workspace filter works with limit and offset", () => {
    const sessions = historyManager.list({
      workspaceDirectory: "/home/user/project-a",
      limit: 1,
      offset: 1,
    });
    expect(sessions.length).toBe(1);
    expect(sessions[0].sessionId).toBe("ws-a-1");
  });
});

describe("Many sessions created", () => {
  test("Create 100 sessions and list all", () => {
    for (let i = 0; i < 100; i++) {
      historyManager.save({
        history: [],
        title: `${i}`,
        workspaceDirectory: "workspaceDir",
        sessionId: `${i}`,
      });
    }
    const sessions = historyManager.list({});
    expect(sessions.length).toBe(100);
  });

  test("List 10 sessions, offest by 10", () => {
    const limit = 10;
    const offset = 10;

    const sessions = historyManager.list({ offset: offset, limit: limit });
    // Sessions are now reversed, so newest (99) comes first
    const sessionIds = Array.from({ length: limit }, (_, i) =>
      (99 - offset - i).toString(),
    );
    const isSessionIdInList = (sessionId: string) =>
      sessions.some((session) => session.sessionId === sessionId);
    expect(sessionIds.every(isSessionIdInList)).toBe(true);
  });

  test("List 25 sessions, with no offset", () => {
    const limit = 25;

    const sessions = historyManager.list({ limit: limit });
    // Sessions are now reversed, so newest (99) comes first
    const sessionIds = Array.from({ length: limit }, (_, i) =>
      (99 - i).toString(),
    );

    const isSessionIdInList = (sessionId: string) =>
      sessions.some((session) => session.sessionId === sessionId);
    expect(sessionIds.every(isSessionIdInList)).toBe(true);
  });

  test("List sessions offset by 75", () => {
    const offset = 75;

    const sessions = historyManager.list({ offset: offset });
    const sessionIds = Array.from(
      { length: sessions.length - offset },
      (_, i) => (i + offset).toString(),
    );

    const isSessionIdInList = (sessionId: string) =>
      sessions.some((session) => session.sessionId === sessionId);
    expect(sessionIds.every(isSessionIdInList)).toBe(true);
  });

  test("Delete all sessions", () => {
    let sessions = historyManager.list({});

    for (let session of sessions) {
      historyManager.delete(session.sessionId);
    }
    sessions = historyManager.list({});
    expect(sessions.length).toBe(0);
  });
});
