import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { afterEach, describe, expect, test, vi } from "vitest";

describe("environment loading", () => {
  const originalGlobalDir = process.env.OCIRCUIT_GLOBAL_DIR;
  const originalApiKey = process.env.OCIRCUIT_API_KEY;
  const originalApiBase = process.env.OCIRCUIT_API_BASE;
  let temporaryHome: string | undefined;

  afterEach(() => {
    if (temporaryHome && fs.existsSync(temporaryHome)) {
      fs.rmSync(temporaryHome, { recursive: true, force: true });
    }

    if (originalGlobalDir === undefined) {
      delete process.env.OCIRCUIT_GLOBAL_DIR;
    } else {
      process.env.OCIRCUIT_GLOBAL_DIR = originalGlobalDir;
    }
    if (originalApiKey === undefined) {
      delete process.env.OCIRCUIT_API_KEY;
    } else {
      process.env.OCIRCUIT_API_KEY = originalApiKey;
    }
    if (originalApiBase === undefined) {
      delete process.env.OCIRCUIT_API_BASE;
    } else {
      process.env.OCIRCUIT_API_BASE = originalApiBase;
    }
    vi.resetModules();
  });

  test("loads hosted API settings from ~/.ocircuit/.env", async () => {
    temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "ocircuit-env-"));
    fs.writeFileSync(
      path.join(temporaryHome, ".env"),
      "OCIRCUIT_API_KEY=file-api-key\nOCIRCUIT_API_BASE=https://file-api.example/\n",
      { mode: 0o600 },
    );
    process.env.OCIRCUIT_GLOBAL_DIR = temporaryHome;
    delete process.env.OCIRCUIT_API_KEY;
    delete process.env.OCIRCUIT_API_BASE;

    vi.resetModules();
    const { env } = await import("./env.js");

    expect(process.env.OCIRCUIT_API_KEY).toBe("file-api-key");
    expect(env.apiBase).toBe("https://file-api.example/");
    expect(env.ocircuitHome).toBe(temporaryHome);
  });

  test("preserves explicitly exported hosted API settings", async () => {
    temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "ocircuit-env-"));
    fs.writeFileSync(
      path.join(temporaryHome, ".env"),
      "OCIRCUIT_API_KEY=file-api-key\nOCIRCUIT_API_BASE=https://file-api.example/\n",
      { mode: 0o600 },
    );
    process.env.OCIRCUIT_GLOBAL_DIR = temporaryHome;
    process.env.OCIRCUIT_API_KEY = "process-api-key";
    process.env.OCIRCUIT_API_BASE = "https://process-api.example/";

    vi.resetModules();
    const { env } = await import("./env.js");

    expect(process.env.OCIRCUIT_API_KEY).toBe("process-api-key");
    expect(env.apiBase).toBe("https://process-api.example/");
  });
});
