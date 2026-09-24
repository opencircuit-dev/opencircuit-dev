import fs from "node:fs";

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { testConfigHandler } from "../test/fixtures";
import { addToTestDir, setUpTestDir, tearDownTestDir } from "../test/testDir";
import {
  DEFAULT_CONFIG_TS_CONTENTS,
  getConfigJsonPath,
  getConfigTsPath,
  getConfigYamlPath,
} from "../util/paths";

import { defaultConfig } from "./default";

describe("Test the ConfigHandler and E2E config loading", () => {
  beforeEach(() => {
    setUpTestDir();
  });

  afterEach(() => {
    tearDownTestDir();
    // Restore config.ts to its default so later tests in this file (and
    // other files sharing the same OCIRCUIT_GLOBAL_DIR) aren't affected
    // by a customized systemMessage left behind by this file's tests.
    fs.writeFileSync(getConfigTsPath(), DEFAULT_CONFIG_TS_CONTENTS);
    // Undo the legacy-JSON-config forcing done in the two tests below, so
    // later tests see the normal YAML-based default profile again.
    const configJsonPath = getConfigJsonPath();
    if (fs.existsSync(configJsonPath)) {
      fs.rmSync(configJsonPath);
    }
    getConfigYamlPath(); // recreates config.yaml if a test deleted it
  });

  test("should show only local profile", () => {
    const currentProfile = testConfigHandler.currentProfile;
    expect(currentProfile?.profileDescription.id).toBe("local");
  });

  test("should load the default config successfully", async () => {
    const result = await testConfigHandler.loadConfig();
    expect(result.config!.modelsByRole.chat.length).toBe(
      defaultConfig.models?.length,
    );
  });

  /**
   * The "local" profile normally loads config from config.yaml (auto-created
   * by getConfigYamlPath), which never consults config.ts/config.json. The
   * legacy config.json + config.ts systemMessage path (config/load.ts's
   * loadOCircuitConfigFromJson) is only reached by doLoadConfig when no
   * config.yaml is present. These two tests force that condition to
   * exercise the legacy path deterministically, matching how a user who
   * hasn't migrated to config.yaml would experience it.
   */
  test("should add a system message from config.ts", async () => {
    const yamlPath = getConfigYamlPath();
    if (fs.existsSync(yamlPath)) {
      fs.rmSync(yamlPath);
    }
    fs.writeFileSync(getConfigJsonPath(), JSON.stringify({ models: [] }));

    const configTs = `export function modifyConfig(config: Config): Config {
    config.systemMessage = "SYSTEM";
    return config;
}`;
    fs.writeFileSync(getConfigTsPath(), configTs);
    const result = await testConfigHandler.reloadConfig("test");
    expect(
      result.config?.rules.some(
        (r) => r.rule === "SYSTEM" && r.source === "json-systemMessage",
      ),
    ).toBe(true);
  });

  test("should acknowledge override from .ocircuitrc.json", async () => {
    const yamlPath = getConfigYamlPath();
    if (fs.existsSync(yamlPath)) {
      fs.rmSync(yamlPath);
    }
    fs.writeFileSync(getConfigJsonPath(), JSON.stringify({ models: [] }));

    addToTestDir([
      [".ocircuitrc.json", JSON.stringify({ systemMessage: "SYSTEM2" })],
    ]);
    const result = await testConfigHandler.reloadConfig("test");
    expect(
      result.config?.rules.some(
        (r) => r.rule === "SYSTEM2" && r.source === "json-systemMessage",
      ),
    ).toBe(true);
  });
});
