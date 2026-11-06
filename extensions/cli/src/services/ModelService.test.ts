import { AssistantUnrolled, ModelConfig } from "@opencircuit/config-yaml";
import { BaseLlmApi, constructLlmApi } from "@opencircuit/openai-adapters";
import { beforeEach, describe, expect, test, vi } from "vitest";

// Mock dependencies before imports
vi.mock("../config.js");
vi.mock("../util/modelPersistence.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../util/modelPersistence.js")>();
  return {
    ...actual,
    getPersistedModelName: vi.fn(),
    getPersistedModelProfileId: vi.fn().mockReturnValue(null),
    persistModelName: vi.fn(),
  };
});

import { AuthConfig } from "../auth/workos.js";
import * as config from "../config.js";
import * as modelPersistence from "../util/modelPersistence.js";

import { ModelService } from "./ModelService.js";

describe("ModelService", () => {
  let service: ModelService;
  let mockAssistant: AssistantUnrolled;
  let mockAuthConfig: AuthConfig;
  const mockLlmApi = { complete: vi.fn(), stream: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(modelPersistence.getPersistedModelName).mockReturnValue(null);
    vi.mocked(modelPersistence.getPersistedModelProfileId).mockReturnValue(
      null,
    );
    service = new ModelService();

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
          model: "claude-3",
          name: "Claude 3",
          apiKey: "test-key",
          roles: ["chat"],
        } as ModelConfig,
        {
          provider: "openai",
          model: "gpt-3.5",
          name: "GPT-3.5",
          apiKey: "test-key",
          roles: ["embed"],
        } as ModelConfig,
      ],
    } as AssistantUnrolled;

    mockAuthConfig = null;
  });

  describe("State Management", () => {
    test("should initialize with default model", async () => {
      vi.mocked(config.getLlmApi).mockReturnValue([
        mockLlmApi as any,
        mockAssistant.models![0] as ModelConfig,
      ]);
      vi.mocked(modelPersistence.getPersistedModelName).mockReturnValue(null);

      const state = await service.initialize(mockAssistant, mockAuthConfig);

      expect(state).toEqual({
        llmApi: mockLlmApi,
        model: mockAssistant.models![0],
        assistant: mockAssistant,
        authConfig: mockAuthConfig,
      });
    });

    test("should initialize with persisted model if valid", async () => {
      vi.mocked(modelPersistence.getPersistedModelName).mockReturnValue(
        "Claude 3",
      );
      vi.mocked(config.createLlmApi).mockReturnValue(mockLlmApi as any);

      const state = await service.initialize(mockAssistant, mockAuthConfig);

      expect(state.model?.name).toBe("Claude 3");
      expect(state.llmApi).toStrictEqual(mockLlmApi);
    });

    test("should fall back to default if persisted model not found", async () => {
      vi.mocked(modelPersistence.getPersistedModelName).mockReturnValue(
        "Non-existent Model",
      );
      vi.mocked(config.getLlmApi).mockReturnValue([
        mockLlmApi as any,
        mockAssistant.models![0] as ModelConfig,
      ]);

      const state = await service.initialize(mockAssistant, mockAuthConfig);

      expect(state.model).toBe(mockAssistant.models![0]);
    });
  });

  describe("setSelectedModel()", () => {
    beforeEach(async () => {
      vi.mocked(modelPersistence.getPersistedModelName).mockReturnValue(null);
      vi.mocked(modelPersistence.persistModelName).mockReset();
      vi.mocked(config.getLlmApi).mockReturnValue([
        mockLlmApi as any,
        mockAssistant.models![0] as ModelConfig,
      ]);
      vi.mocked(config.createLlmApi).mockReturnValue(mockLlmApi as any);
      await service.initialize(mockAssistant, mockAuthConfig);
    });

    test("switches in memory before saving the selected model", async () => {
      vi.mocked(modelPersistence.persistModelName).mockImplementation(
        (name) => {
          expect(service.getState().model?.name).toBe(name);
        },
      );
      const result = await service.setSelectedModel(1);
      expect(result.persisted).toBe(true);
      expect(result.state.model?.name).toBe("Claude 3");
      expect(modelPersistence.persistModelName).toHaveBeenCalledWith(
        "Claude 3",
        mockAssistant.models![1],
      );
      expect(result.state.assistant).toBe(mockAssistant);
    });

    test("keeps the selected model active when persistence fails", async () => {
      vi.mocked(modelPersistence.persistModelName).mockImplementation(() => {
        throw new Error("Cannot write preferences");
      });
      const result = await service.setSelectedModel(1);
      expect(result.persisted).toBe(false);
      expect(service.getState().model?.name).toBe("Claude 3");
    });

    test("retains a session-only selection when the service reloads", async () => {
      vi.mocked(modelPersistence.getPersistedModelName).mockReturnValue(
        "GPT-4",
      );
      vi.mocked(modelPersistence.persistModelName).mockImplementation(() => {
        throw new Error("Cannot write preferences");
      });

      await service.setSelectedModel(1);
      const state = await service.reload(mockAssistant, mockAuthConfig);

      expect(state.model?.name).toBe("Claude 3");
    });

    test("preserves agent-file precedence over a session selection", async () => {
      await service.setSelectedModel(1);
      const state = await service.reload(mockAssistant, mockAuthConfig, {
        agentFileModel: { name: "GPT-4" },
      });

      expect(state.model?.name).toBe("GPT-4");
    });

    test("retains the selected provider when model names are identical", async () => {
      mockAssistant.models![1]!.name = "GPT-4";
      await service.setSelectedModel(1);
      const state = await service.reload(mockAssistant, mockAuthConfig);

      expect(state.model?.provider).toBe("anthropic");
    });

    test("falls back when the session model is removed from the config", async () => {
      await service.setSelectedModel(1);
      const assistant = {
        ...mockAssistant,
        models: [mockAssistant.models![0]],
      };
      const state = await service.reload(assistant, mockAuthConfig);

      expect(state.model?.name).toBe("GPT-4");
    });

    test.each([-1, 2, NaN, 0.5])(
      "rejects invalid index %s without saving",
      async (index) => {
        const previousState = service.getState();
        await expect(service.setSelectedModel(index)).rejects.toThrow();
        expect(service.getState()).toEqual(previousState);
        expect(modelPersistence.persistModelName).not.toHaveBeenCalled();
      },
    );

    test("does not persist when model initialization fails", async () => {
      service.on("error", () => {});
      vi.mocked(config.createLlmApi).mockImplementation(() => {
        throw new Error("Model unavailable");
      });
      const previousState = service.getState();
      await expect(service.setSelectedModel(1)).rejects.toThrow(
        "Model unavailable",
      );
      expect(service.getState()).toEqual(previousState);
      expect(modelPersistence.persistModelName).not.toHaveBeenCalled();
    });
  });

  describe("switchModel()", () => {
    test("should switch to a different model by index", async () => {
      vi.mocked(config.getLlmApi).mockReturnValue([
        mockLlmApi as any,
        mockAssistant.models![0] as ModelConfig,
      ]);
      await service.initialize(mockAssistant, mockAuthConfig);

      const newLlmApi = { complete: vi.fn(), stream: vi.fn() };
      vi.mocked(config.createLlmApi).mockReturnValue(newLlmApi as any);

      const state = await service.switchModel(1);

      expect(state).toEqual({
        llmApi: newLlmApi,
        model: mockAssistant.models![1],
        assistant: mockAssistant,
        authConfig: mockAuthConfig,
      });
      expect(service.getState()).toEqual(state);
    });

    test("should throw error for invalid model index", async () => {
      vi.mocked(config.getLlmApi).mockReturnValue([
        mockLlmApi as any,
        mockAssistant.models![0] as ModelConfig,
      ]);
      await service.initialize(mockAssistant, mockAuthConfig);

      await expect(service.switchModel(5)).rejects.toThrow(
        "Invalid model index: 5. Available models: 0-1",
      );
      await expect(service.switchModel(-1)).rejects.toThrow(
        "Invalid model index: -1. Available models: 0-1",
      );
    });

    test("should throw error when service not initialized", async () => {
      await expect(service.switchModel(0)).rejects.toThrow(
        "ModelService not initialized",
      );
    });

    test("should handle ocircuit-proxy provider specially", async () => {
      const proxyModel = {
        provider: "ocircuit-proxy",
        model: "proxy-model",
        name: "Proxy Model",
        apiBase: "https://proxy.ocircuit.dev",
        apiKeyLocation: "env.PROXY_KEY",
        roles: ["chat"],
      } as ModelConfig;

      mockAssistant.models = [proxyModel];
      vi.mocked(config.getLlmApi).mockReturnValue([
        mockLlmApi as any,
        proxyModel,
      ]);
      await service.initialize(mockAssistant, mockAuthConfig);

      vi.mocked(config.createLlmApi).mockReturnValue(mockLlmApi as any);

      await service.switchModel(0);

      expect(vi.mocked(config.createLlmApi)).toHaveBeenCalledWith(
        proxyModel,
        mockAuthConfig,
      );
    });
  });

  describe("getAvailableChatModels()", () => {
    test("should return only models with chat role", async () => {
      vi.mocked(config.getLlmApi).mockReturnValue([
        mockLlmApi as any,
        mockAssistant.models![0] as ModelConfig,
      ]);
      await service.initialize(mockAssistant, mockAuthConfig);

      const models = service.getAvailableChatModels();

      expect(models).toHaveLength(2);
      expect(models[0]).toEqual({
        provider: "openai",
        name: "GPT-4",
        index: 0,
      });
      expect(models[1]).toEqual({
        provider: "anthropic",
        name: "Claude 3",
        index: 1,
      });
    });

    test("should include models with undefined roles", async () => {
      // Add a model with undefined roles to the assistant
      const assistantWithUndefinedRoles = {
        ...mockAssistant,
        models: [
          ...mockAssistant.models!,
          {
            provider: "local",
            model: "llama-2",
            name: "Llama 2",
            apiKey: "test-key",
            // roles is undefined
          } as ModelConfig,
        ],
      };

      vi.mocked(config.getLlmApi).mockReturnValue([
        mockLlmApi as any,
        assistantWithUndefinedRoles.models![0] as ModelConfig,
      ]);
      await service.initialize(assistantWithUndefinedRoles, mockAuthConfig);

      const models = service.getAvailableChatModels();

      // Should include the two chat models and the model with undefined roles
      expect(models).toHaveLength(3);
      expect(models[2]).toEqual({
        provider: "local",
        name: "Llama 2",
        index: 2,
      });
    });
  });

  describe("getCurrentModelIndex()", () => {
    test("should return correct index of current model", async () => {
      vi.mocked(config.getLlmApi).mockReturnValue([
        mockLlmApi as any,
        mockAssistant.models![0] as ModelConfig,
      ]);
      await service.initialize(mockAssistant, mockAuthConfig);

      expect(service.getCurrentModelIndex()).toBe(0);

      vi.mocked(config.createLlmApi).mockReturnValue(mockLlmApi as any);
      await service.switchModel(1);
      expect(service.getCurrentModelIndex()).toBe(1);
    });

    describe("discoverModels()", () => {
      let api: BaseLlmApi;

      beforeEach(() => {
        const constructed = constructLlmApi({
          provider: "openai",
          apiKey: "test-key",
        });
        if (!constructed)
          throw new Error("Test OpenAI adapter was not created");
        api = constructed;
        vi.spyOn(api, "list").mockResolvedValue([]);
        vi.mocked(config.getLlmApi).mockReturnValue([
          api,
          mockAssistant.models![0]!,
        ]);
        vi.mocked(config.createLlmApi).mockReturnValue(api);
        vi.mocked(modelPersistence.getPersistedModelName).mockReturnValue(null);
      });

      const catalog = (
        ids: string[],
      ): Awaited<ReturnType<BaseLlmApi["list"]>> =>
        ids.map((id) => ({
          id,
          object: "model",
          created: 0,
          owned_by: "openai",
        }));

      test("filters specialized models and redundant snapshots, and registers selections", async () => {
        vi.mocked(api.list).mockResolvedValue(
          catalog([
            "gpt-4",
            "gpt-4-0613",
            "gpt-4.1",
            "gpt-4.1-2025-04-14",
            "gpt-5",
            "gpt-5-chat-latest",
            "gpt-5.5",
            "gpt-5.5",
            "gpt-5.5-2026-04-23",
            "gpt-4o-mini-transcribe",
            "gpt-4o-mini-tts",
            "gpt-4o-search-preview",
            "gpt-5-codex",
            "gpt-5-pro",
            "text-embedding-3-small",
            "dall-e-3",
            "unknown-model",
          ]),
        );
        await service.initialize(mockAssistant, mockAuthConfig);
        await expect(service.discoverModels()).resolves.toBeNull();

        expect(service.getAvailableChatModels()).toEqual([
          { provider: "openai", name: "GPT-4", index: 0 },
          { provider: "anthropic", name: "Claude 3", index: 1 },
          { provider: "openai", name: "gpt-4.1", index: 2, discovered: true },
          { provider: "openai", name: "gpt-5", index: 3, discovered: true },
          { provider: "openai", name: "gpt-5.5", index: 4, discovered: true },
        ]);
        expect(mockAssistant.models).toHaveLength(3);
        const state = await service.switchModel(4);
        expect(state.model?.model).toBe("gpt-5.5");
        expect(config.createLlmApi).toHaveBeenLastCalledWith(
          state.model,
          mockAuthConfig,
        );
        expect(service.getCurrentModelIndex()).toBe(4);
        expect(service.getModelIndexByName("gpt-5.5", "openai")).toBe(4);
        await service.discoverModels();
        expect(service.getAvailableChatModels()).toHaveLength(5);
      });

      test("preserves provider settings and disabled tools without assigning subagent roles", async () => {
        const template = mockAssistant.models![0]!;
        template.apiBase = "https://example.test/v1/";
        template.roles = ["chat", "subagent"];
        template.chatOptions = {
          disableTools: true,
          baseSystemMessage: "Keep this",
        };
        template.requestOptions = {
          timeout: 2000,
          headers: { "X-Deployment": "test" },
          proxy: "http://proxy.test",
        };
        vi.mocked(api.list).mockResolvedValue(catalog(["gpt-4.1"]));
        await service.initialize(mockAssistant, mockAuthConfig);
        await service.discoverModels();
        const state = await service.switchModel(2);
        expect(state.model).toEqual({
          ...template,
          name: "gpt-4.1",
          model: "gpt-4.1",
          roles: ["chat"],
        });
        expect(config.createLlmApi).toHaveBeenNthCalledWith(
          1,
          template,
          mockAuthConfig,
        );
      });

      test("keeps configured models usable and reports credential failures without exposing keys", async () => {
        vi.mocked(api.list).mockRejectedValue({
          status: 401,
          message: "Incorrect API key: sk-do-not-display",
        });
        await service.initialize(mockAssistant, mockAuthConfig);
        const warning = await service.discoverModels();
        expect(warning).toContain("HTTP 401");
        expect(warning).not.toContain("sk-do-not-display");
        expect(service.getAvailableChatModels()).toHaveLength(2);
        await expect(service.switchModel(0)).resolves.toMatchObject({
          llmApi: api,
        });
      });

      test("discovers OLMo models while preserving disabled tools", async () => {
        const olmo: ModelConfig = {
          provider: "openai-compatible",
          name: "OLMo",
          model: "olmo2:7b",
          apiBase: "http://ollama.test:11434/v1/",
          roles: ["chat"],
          chatOptions: { disableTools: true },
        };
        mockAssistant.models = [olmo];
        vi.mocked(config.getLlmApi).mockReturnValue([api, olmo]);
        vi.mocked(api.list).mockResolvedValue(
          catalog([
            "olmo2:7b",
            "olmo2:13b",
            "nomic-embed-text",
            "llama-guard3",
            "unknown-model",
          ]),
        );
        await service.initialize(mockAssistant, mockAuthConfig);
        await expect(service.discoverModels()).resolves.toBeNull();
        expect(api.list).toHaveBeenCalled();
        const state = await service.switchModel(1);
        expect(state.model?.model).toBe("olmo2:13b");
        expect(state.model?.chatOptions?.disableTools).toBe(true);
        expect(state.model?.apiBase).toBe(olmo.apiBase);
        expect(service.getAvailableChatModels()).toHaveLength(2);
      });

      test.each([
        [
          "anthropic",
          "claude-sonnet-4-6",
          ["claude-haiku-4-5", "gpt-4.1", "unknown-model"],
          "claude-haiku-4-5",
        ],
        [
          "gemini",
          "gemini-3.8-flash",
          [
            "gemini-3.1-pro-preview",
            "gemini-2.5-flash-preview-tts",
            "gemini-embedding-001",
          ],
          "gemini-3.1-pro-preview",
        ],
        [
          "openai-compatible",
          "muse-spark-1.3",
          ["muse-spark-1.4", "text-embedding-3-small", "unknown-model"],
          "muse-spark-1.4",
        ],
      ] as const)(
        "discovers chat models for %s",
        async (provider, model, ids, discovered) => {
          const template: ModelConfig = {
            ...mockAssistant.models![0]!,
            provider,
            model,
            apiBase: "https://example.test/v1/",
            name: "Configured",
          };
          mockAssistant.models = [template];
          vi.mocked(config.getLlmApi).mockReturnValue([api, template]);
          vi.mocked(api.list).mockResolvedValue(catalog([...ids]));
          await service.initialize(mockAssistant, mockAuthConfig);
          await expect(service.discoverModels()).resolves.toBeNull();
          expect(service.getAvailableChatModels()).toHaveLength(2);
          expect((await service.switchModel(1)).model).toMatchObject({
            provider,
            model: discovered,
            apiBase: template.apiBase,
            apiKey: template.apiKey,
          });
        },
      );

      test("accepts custom BYOM chat metadata, rejects embedding metadata, and reports unknown-only catalogs", async () => {
        const template: ModelConfig = {
          ...mockAssistant.models![0]!,
          provider: "openai-compatible",
          model: "my-model",
          apiBase: "https://example.test/v1/",
        };
        mockAssistant.models = [template];
        vi.mocked(config.getLlmApi).mockReturnValue([api, template]);
        vi.mocked(api.list).mockResolvedValue(
          catalog(["bespoke-model-v2", "qwen3-unknown"]).map(
            (model, index) => ({
              ...model,
              capabilities: index === 0 ? { chat: true } : ["embedding"],
            }),
          ),
        );
        await service.initialize(mockAssistant, mockAuthConfig);
        await service.discoverModels();
        expect(
          service.getAvailableChatModels().map((model) => model.name),
        ).toEqual([template.name, "bespoke-model-v2"]);
        vi.mocked(api.list).mockResolvedValue(catalog(["unknown-model"]));
        expect(await service.discoverModels()).toContain(
          "no identifiable chat models",
        );
      });

      test("ignores results from a configuration replaced while discovery was pending", async () => {
        let resolveCatalog:
          | ((value: Awaited<ReturnType<BaseLlmApi["list"]>>) => void)
          | undefined;
        vi.mocked(api.list).mockImplementation(
          () =>
            new Promise((resolve) => {
              resolveCatalog = resolve;
            }),
        );
        await service.initialize(mockAssistant, mockAuthConfig);
        const request = service.discoverModels();
        const replacement = { ...mockAssistant, name: "replacement" };
        await service.initialize(replacement, mockAuthConfig);
        if (!resolveCatalog) throw new Error("Catalog request did not start");
        resolveCatalog(catalog(["gpt-5"]));
        await request;
        expect(service.getState().assistant).toBe(replacement);
        expect(service.getAvailableChatModels()).toHaveLength(2);
      });

      test("restores a previously discovered model without a startup network request", async () => {
        vi.mocked(modelPersistence.getPersistedModelName).mockReturnValue(
          "gpt-5.5",
        );
        const state = await service.initialize(mockAssistant, mockAuthConfig);
        expect(state.model?.model).toBe("gpt-5.5");
        expect(service.getAvailableChatModels()[2]?.discovered).toBe(true);
        expect(api.list).not.toHaveBeenCalled();
      });

      test("uses an explicitly configured model when restoring its discovered ID", async () => {
        vi.mocked(modelPersistence.getPersistedModelName).mockReturnValue(
          "gpt-4",
        );
        const state = await service.initialize(mockAssistant, mockAuthConfig);
        expect(state.model).toBe(mockAssistant.models![0]);
        expect(service.getAvailableChatModels()).toHaveLength(2);
        expect(service.getAvailableChatModels()[0]?.discovered).toBeUndefined();
      });

      test("keeps selection and credentials scoped to the endpoint that discovered a model", async () => {
        const first = mockAssistant.models![0]!;
        const second = {
          ...first,
          name: "Other endpoint",
          apiBase: "https://other.example.test/v1/",
          apiKey: "other-test-key",
        };
        mockAssistant.models = [first, second];
        vi.mocked(api.list).mockResolvedValue(catalog(["gpt-4.1"]));
        await service.initialize(mockAssistant, mockAuthConfig);
        await service.discoverModels();
        await service.switchModel(1);
        await service.discoverModels();
        const state = await service.switchModel(3);
        expect(state.model?.apiKey).toBe("other-test-key");
        expect(state.model?.apiBase).toBe(second.apiBase);
        expect(service.getCurrentModelIndex()).toBe(3);
      });
    });

    test("should return -1 when no model is set", () => {
      expect(service.getCurrentModelIndex()).toBe(-1);
    });
  });

  describe("getModelIndexByName()", () => {
    test("should find model by name", async () => {
      vi.mocked(config.getLlmApi).mockReturnValue([
        mockLlmApi as any,
        mockAssistant.models![0] as ModelConfig,
      ]);
      await service.initialize(mockAssistant, mockAuthConfig);

      expect(service.getModelIndexByName("GPT-4")).toBe(0);
      expect(service.getModelIndexByName("Claude 3")).toBe(1);
      expect(service.getModelIndexByName("Non-existent")).toBe(-1);
    });

    test("should find model by name and provider", async () => {
      vi.mocked(config.getLlmApi).mockReturnValue([
        mockLlmApi as any,
        mockAssistant.models![0] as ModelConfig,
      ]);
      await service.initialize(mockAssistant, mockAuthConfig);

      expect(service.getModelIndexByName("GPT-4", "openai")).toBe(0);
      expect(service.getModelIndexByName("GPT-4", "anthropic")).toBe(-1);
    });
  });

  describe("getModelInfo()", () => {
    test("should return current model info", async () => {
      vi.mocked(config.getLlmApi).mockReturnValue([
        mockLlmApi as any,
        mockAssistant.models![0] as ModelConfig,
      ]);
      await service.initialize(mockAssistant, mockAuthConfig);

      expect(service.getModelInfo()).toEqual({
        provider: "openai",
        name: "GPT-4",
      });
    });

    test("should return null when no model set", () => {
      expect(service.getModelInfo()).toBeNull();
    });
  });

  describe("isReady()", () => {
    test("should return false when not initialized", () => {
      expect(service.isReady()).toBe(false);
    });

    test("should return true when initialized with model and llmApi", async () => {
      vi.mocked(config.getLlmApi).mockReturnValue([
        mockLlmApi as any,
        mockAssistant.models![0] as ModelConfig,
      ]);
      await service.initialize(mockAssistant, mockAuthConfig);

      expect(service.isReady()).toBe(true);
    });

    test("should return false if llmApi is null", async () => {
      vi.mocked(config.getLlmApi).mockReturnValue([
        null as any,
        mockAssistant.models![0] as ModelConfig,
      ]);
      await service.initialize(mockAssistant, mockAuthConfig);

      expect(service.isReady()).toBe(false);
    });
  });

  describe("getDependencies()", () => {
    test("should declare auth, config, and agent-file dependencies", () => {
      expect(service.getDependencies()).toEqual([
        "auth",
        "config",
        "agentFile",
      ]);
    });
  });

  describe("Event Emission", () => {
    test("should emit stateChanged on model switch", async () => {
      vi.mocked(config.getLlmApi).mockReturnValue([
        mockLlmApi as any,
        mockAssistant.models![0] as ModelConfig,
      ]);
      await service.initialize(mockAssistant, mockAuthConfig);

      const listener = vi.fn();
      service.on("stateChanged", listener);

      const newLlmApi = { complete: vi.fn(), stream: vi.fn() };
      vi.mocked(config.createLlmApi).mockReturnValue(newLlmApi as any);
      await service.switchModel(1);

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          model: mockAssistant.models![1],
          llmApi: newLlmApi,
        }),
        expect.objectContaining({
          model: mockAssistant.models![0],
          llmApi: mockLlmApi,
        }),
      );
    });

    test("should emit error on switch failure", async () => {
      vi.mocked(config.getLlmApi).mockReturnValue([
        mockLlmApi as any,
        mockAssistant.models![0] as ModelConfig,
      ]);
      await service.initialize(mockAssistant, mockAuthConfig);

      const errorListener = vi.fn();
      service.on("error", errorListener);

      vi.mocked(config.createLlmApi).mockReturnValue(null as any);

      await expect(service.switchModel(1)).rejects.toThrow(
        "Failed to initialize LLM",
      );
      expect(errorListener).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
