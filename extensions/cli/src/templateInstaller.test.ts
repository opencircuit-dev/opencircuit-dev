import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { env } from "./env.js";
import { installPackagedTemplates } from "./templateInstaller.js";

describe("installPackagedTemplates", () => {
  const originalHome = env.ocircuitHome;
  let temporaryHome: string;

  beforeEach(() => {
    temporaryHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "ocircuit-templates-"),
    );
    env.ocircuitHome = temporaryHome;
  });

  afterEach(() => {
    env.ocircuitHome = originalHome;
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  });

  it("copies every packaged template with private permissions", () => {
    const result = installPackagedTemplates();
    const templateDirectory = path.join(temporaryHome, "templates");
    const expectedTemplates = [
      "config-anthropic.yaml",
      "config-byom.yaml",
      "config-gemini.yaml",
      "config-olmo.yaml",
      "config-openai.yaml",
    ];

    expect(result.installed).toEqual(expectedTemplates);
    expect(result.preserved).toEqual([]);
    expect(fs.readdirSync(templateDirectory)).toEqual(expectedTemplates);

    if (process.platform !== "win32") {
      expect(fs.statSync(temporaryHome).mode & 0o777).toBe(0o700);
      expect(fs.statSync(templateDirectory).mode & 0o777).toBe(0o700);
      expect(
        fs.statSync(path.join(templateDirectory, expectedTemplates[0])).mode &
          0o777,
      ).toBe(0o600);
    }
  });

  it("is idempotent and preserves existing templates", () => {
    const templateDirectory = path.join(temporaryHome, "templates");
    fs.mkdirSync(templateDirectory, { recursive: true });
    const existingPath = path.join(templateDirectory, "config-openai.yaml");
    fs.writeFileSync(existingPath, "user-owned-config\n");

    const result = installPackagedTemplates();

    expect(result.installed).toEqual([
      "config-anthropic.yaml",
      "config-byom.yaml",
      "config-gemini.yaml",
      "config-olmo.yaml",
    ]);
    expect(result.preserved).toEqual(["config-openai.yaml"]);
    expect(fs.readFileSync(existingPath, "utf8")).toBe("user-owned-config\n");

    const rerun = installPackagedTemplates();
    expect(rerun.installed).toEqual([]);
    expect(rerun.preserved).toEqual([
      "config-anthropic.yaml",
      "config-byom.yaml",
      "config-gemini.yaml",
      "config-olmo.yaml",
      "config-openai.yaml",
    ]);
  });
});
