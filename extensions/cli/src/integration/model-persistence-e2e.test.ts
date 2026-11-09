import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { AssistantUnrolled, ModelConfig } from "@opencircuit/config-yaml";
import { constructLlmApi } from "@opencircuit/openai-adapters";
import { GlobalContext } from "core/globalContext.js";
import { getGlobalContextFilePath } from "core/util/paths.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getModelName, updateModelName } from "../auth/workos.js";
import * as config from "../config.js";
import { ModelService } from "../services/ModelService.js";
import { persistModelName } from "../util/modelPersistence.js";

// Mock the config module
vi.mock("../config.js");

describe("Model Persistence End-to-End", () => {
  let testDir: string;
  let originalOCircuitHome: string | undefined;
  let mockAssistant: AssistantUnrolled;
  const mockLlmApi = { complete: vi.fn(), stream: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create a temporary directory for testing
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "ocircuit-test-"));
    originalOCircuitHome = process.env.OCIRCUIT_GLOBAL_DIR;
    process.env.OCIRCUIT_GLOBAL_DIR = testDir;

    // Clear GlobalContext for clean test state
    persistModelName(null);

    mockAssistant = {
      name: "test-assistant",
      version: "1.0.0",
      models: [
        {
          provider: "openai",
          model: "gpt-4",
          name: "GPT-4",
          apiKey: "test-key",
          roles: ["chat"],
        } as ModelConfig,
        {
          provider: "anthropic",
          model: "claude-3-5-sonnet-20241022",
          name: "Claude 3.5 Sonnet",
          apiKey: "test-key",
          roles: ["chat"],
        } as ModelConfig,
        {
          provider: "anthropic",
          model: "claude-3-opus-20240229",
          name: "Claude 3 Opus",
          apiKey: "test-key",
          roles: ["chat"],
        } as ModelConfig,
      ],
    } as AssistantUnrolled;

    // Setup default mock behavior
    vi.mocked(config.getLlmApi).mockReturnValue([
      mockLlmApi as any,
      mockAssistant.models![0] as ModelConfig,
    ]);
    vi.mocked(config.createLlmApi).mockReturnValue(mockLlmApi as any);
  });

  afterEach(() => {
    // Clear persisted model to avoid cross-test contamination
    persistModelName(null);

    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    if (originalOCircuitHome) {
      process.env.OCIRCUIT_GLOBAL_DIR = originalOCircuitHome;
    } else {
      delete process.env.OCIRCUIT_GLOBAL_DIR;
    }
  });

  test("should restore model selection after switch and restart", async () => {
    const context = new GlobalContext();
    context.update("autoUpdateCli", false);
    const initialService = new ModelService();
    await initialService.initialize(mockAssistant, null);
    const selection = await initialService.setSelectedModel(1);
    expect(selection.persisted).toBe(true);
    expect(initialService.getState().model?.name).toBe("Claude 3.5 Sonnet");
    expect(new GlobalContext().get("autoUpdateCli")).toBe(false);

    // Verify it was saved
    expect(getModelName(null)).toBe("Claude 3.5 Sonnet");

    // Step 2: Create a new service (simulating restart) - should restore persisted model
    const service = new ModelService();
    const state = await service.initialize(mockAssistant, null);

    // Verify the persisted model is restored
    expect(state.model?.name).toBe("Claude 3.5 Sonnet");
    expect(state.model?.provider).toBe("anthropic");
  });

  test("persists discovered selections through the canonical service and retains them across reloads", async () => {
    const template: ModelConfig = {
      provider: "openai-compatible",
      name: "OLMo",
      model: "olmo2:7b",
      apiBase: "https://example.test/v1/",
      apiKey: "fake-key",
      roles: ["chat"],
      chatOptions: { disableTools: true },
    };
    const assistant: AssistantUnrolled = {
      ...mockAssistant,
      models: [template],
    };
    const api = constructLlmApi({ provider: "openai", apiKey: "fake-key" });
    if (!api) throw new Error("Test adapter could not be initialized");
    vi.spyOn(api, "list").mockResolvedValue([
      { id: "olmo2:13b", object: "model", created: 0, owned_by: "fixture" },
    ]);
    vi.mocked(config.getLlmApi).mockReturnValue([api, template]);
    vi.mocked(config.createLlmApi).mockReturnValue(api);
    const service = new ModelService();
    await service.initialize(assistant, null);
    await service.discoverModels();
    expect((await service.setSelectedModel(1)).persisted).toBe(true);
    expect((await service.reload(assistant, null)).model?.model).toBe(
      "olmo2:13b",
    );
    const restarted = new ModelService();
    const restored = await restarted.initialize(assistant, null);
    expect(restored.model?.model).toBe("olmo2:13b");
    expect(restored.model?.chatOptions?.disableTools).toBe(true);
    const changed = { ...template, apiKey: "different-fake-key" };
    vi.mocked(config.getLlmApi).mockReturnValue([api, changed]);
    expect(
      (await service.reload({ ...assistant, models: [changed] }, null)).model,
    ).toBe(changed);
    expect(api.list).toHaveBeenCalledOnce();
  });

  test.each(["anthropic", "gemini", "openai-compatible"] as const)(
    "restores discovered %s IDs only for the matching provider profile",
    async (provider) => {
      const template: ModelConfig = {
        provider,
        name: "Configured profile",
        model: "configured-model",
        apiBase: "https://example.test/v1/",
        apiKey: "fake-private-key",
        chatOptions: { disableTools: true },
        roles: ["chat"],
      };
      const assistant: AssistantUnrolled = {
        ...mockAssistant,
        models: [template],
      };
      const api = constructLlmApi({ provider: "openai", apiKey: "fake-key" });
      if (!api) throw new Error("Test adapter could not be initialized");
      vi.mocked(config.getLlmApi).mockReturnValue([api, template]);
      vi.mocked(config.createLlmApi).mockReturnValue(api);
      updateModelName("custom-discovered-id", template);
      const service = new ModelService();
      const state = await service.initialize(assistant, null);
      expect(state.model?.model).toBe("custom-discovered-id");
      expect(state.model?.chatOptions?.disableTools).toBe(true);
      expect(service.getCurrentModelProfile()).toBe(template);
      const persisted = fs.readFileSync(getGlobalContextFilePath(), "utf8");
      expect(persisted).not.toContain(template.apiKey);
      expect(persisted).not.toContain(template.apiBase);
      const changed = {
        ...template,
        apiBase: "https://other.example.test/v1/",
      };
      vi.mocked(config.getLlmApi).mockReturnValue([api, changed]);
      const other = new ModelService();
      expect(
        (await other.initialize({ ...assistant, models: [changed] }, null))
          .model,
      ).toBe(changed);
    },
  );

  test("should handle model name mismatch gracefully", async () => {
    // Save a model name that doesn't exist in the assistant
    updateModelName("Non-existent Model");

    const service = new ModelService();
    const state = await service.initialize(mockAssistant, null);

    // Should fall back to first available model (GPT-4)
    expect(state.model?.name).toBe("GPT-4");
  });

  test("does not reuse a stale provider scope when an older CLI changes only the model name", async () => {
    const template: ModelConfig = {
      provider: "gemini",
      name: "Configured Gemini",
      model: "gemini-3.8-flash",
      apiKey: "fake-key",
      roles: ["chat"],
    };
    updateModelName("gemini-3.1-pro-preview", template);
    new GlobalContext().update("cliSelectedModel", "gpt-5.5");
    const api = constructLlmApi({ provider: "openai", apiKey: "fake-key" });
    if (!api) throw new Error("Test adapter could not be initialized");
    vi.mocked(config.getLlmApi).mockReturnValue([api, template]);
    const service = new ModelService();
    expect(
      (await service.initialize({ ...mockAssistant, models: [template] }, null))
        .model,
    ).toBe(template);
  });

  test("should check both name and model fields when matching", async () => {
    // Some configs might have model field instead of name
    const assistantWithModelField = {
      ...mockAssistant,
      models: [
        {
          provider: "openai",
          model: "gpt-4",
          // No name field, just model
          apiKey: "test-key",
          roles: ["chat"],
        } as ModelConfig,
        {
          provider: "anthropic",
          model: "claude-3-5-sonnet-20241022",
          // No name field, just model
          apiKey: "test-key",
          roles: ["chat"],
        } as ModelConfig,
      ],
    } as AssistantUnrolled;

    const initialService = new ModelService();
    await initialService.initialize(assistantWithModelField, null);
    expect((await initialService.setSelectedModel(1)).persisted).toBe(true);

    const service = new ModelService();
    const state = await service.initialize(assistantWithModelField, null);

    // Should match by model field
    expect(state.model?.model).toBe("claude-3-5-sonnet-20241022");
  });

  test("should persist model through multiple switches", async () => {
    const service = new ModelService();
    // Clear any persisted model first
    persistModelName(null);
    await service.initialize(mockAssistant, null);

    // Switch to Claude 3.5 Sonnet
    await service.setSelectedModel(1);
    expect(getModelName(null)).toBe("Claude 3.5 Sonnet");

    // Switch to Claude 3 Opus
    await service.setSelectedModel(2);
    expect(getModelName(null)).toBe("Claude 3 Opus");

    // Restart and verify last selection
    const newService = new ModelService();
    const state = await newService.initialize(mockAssistant, null);
    expect(state.model?.name).toBe("Claude 3 Opus");
  });
});
