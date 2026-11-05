import { AssistantUnrolled, ModelConfig } from "@opencircuit/config-yaml";

import { AuthConfig, getModelName } from "../auth/workos.js";
import { createLlmApi, getLlmApi } from "../config.js";
import { logger } from "../util/logger.js";
import {
  getPersistedModelProfileId,
  modelProfileId,
} from "../util/modelPersistence.js";

import { BaseService, ServiceWithDependencies } from "./BaseService.js";
import { AgentFileServiceState, ModelServiceState } from "./types.js";

function discoverableOpenAIModels(ids: string[]): string[] {
  // The catalog has no capability metadata; exclude unknown and specialized APIs.
  const chatModel =
    /^(gpt-(?:3\.5-turbo(?:-16k)?|4(?:-turbo|-32k)?|4o(?:-mini)?|4\.1(?:-mini|-nano)?|5(?:\.\d+)?(?:-mini|-nano)?(?:-chat-latest)?)|o[134](?:-mini)?)(?:-(?:\d{4}-\d{2}-\d{2}|\d{4}))?$/;
  const available = new Set(ids.filter((id) => typeof id === "string"));
  return [...available]
    .filter((id) => {
      const match = id.match(chatModel);
      if (!match) return false;
      if (id !== match[1] && available.has(match[1])) return false;
      return (
        !id.endsWith("-chat-latest") ||
        !available.has(id.replace(/-chat-latest$/, ""))
      );
    })
    .sort();
}

const discoveryProviders = new Set([
  "openai",
  "anthropic",
  "gemini",
  "openai-compatible",
]);
const claudeChatModel =
  /^claude-(?:(?:\d+(?:-\d+)*-)?(?:sonnet|haiku|opus)(?:-[a-z0-9]+)*|(?:instant-)?\d+(?:\.\d+)?(?:-\d{8})?)$/;
const geminiChatModel =
  /^gemini-\d+(?:\.\d+)?-(?:pro|flash(?:-lite|-8b)?)(?:-(?:latest|\d{3}|preview|exp)(?:-\d{2}-\d{2}|\d{4})?)?$/;

function compatibleChatModel(model: { id: string }): boolean {
  const id = model.id;
  if (
    typeof id !== "string" ||
    /embed|rerank|whisper|transcrib|speech|tts|diffusion|image|guard|moderation|reward|(?:^|[/:-])flux(?:$|[/:.-])/i.test(
      id,
    )
  ) {
    return false;
  }
  if ("capabilities" in model) {
    const capabilities = model.capabilities;
    const chat = ["chat", "chat_completion", "chat_completions", "completion"];
    if (Array.isArray(capabilities)) {
      return capabilities.some((capability) => chat.includes(capability));
    }
    if (capabilities && typeof capabilities === "object") {
      return Object.entries(capabilities).some(
        ([capability, enabled]) =>
          chat.includes(capability) && enabled === true,
      );
    }
    return false;
  }
  // Compatible catalogs commonly omit capabilities; only infer known chat families.
  return (
    discoverableOpenAIModels([id]).length > 0 ||
    claudeChatModel.test(id) ||
    geminiChatModel.test(id) ||
    /(?:^|\/)(?:olmo\d*|muse-spark|llama(?:\d|[-_.])|qwen(?:\d|[-_.])|deepseek|mistral|mixtral|gemma(?:\d|[-_.])|phi[-\d]|command-[ra])[\w.:/-]*$/i.test(
      id,
    ) ||
    /(?:^|[-_/])(?:chat|instruct)(?:$|[-_.:])/i.test(id)
  );
}

function discoverableChatModels(
  provider: string,
  catalog: { id: string }[],
): string[] {
  if (provider === "openai") {
    return discoverableOpenAIModels(catalog.map((model) => model?.id));
  }
  return [
    ...new Set(
      catalog
        .filter((model) => {
          if (typeof model?.id !== "string") return false;
          if (provider === "anthropic") return claudeChatModel.test(model.id);
          if (provider === "gemini") return geminiChatModel.test(model.id);
          return provider === "openai-compatible" && compatibleChatModel(model);
        })
        .map((model) => model.id),
    ),
  ].sort();
}

/**
 * Service for managing LLM and model state
 * Depends on auth config and assistant config
 */
export class ModelService
  extends BaseService<ModelServiceState>
  implements ServiceWithDependencies
{
  private availableModels: ModelConfig[] = [];
  private assistant: AssistantUnrolled | null = null;
  private authConfig: AuthConfig | null = null;
  private discoveredModels = new Map<ModelConfig, ModelConfig>();

  constructor() {
    super("ModelService", {
      llmApi: null,
      model: null,
      assistant: null,
      authConfig: null,
    });
  }

  /**
   * Declare dependencies on other services
   */
  getDependencies(): string[] {
    return ["auth", "config", "agentFile"];
  }

  /**
   * Initialize the model service
   */
  async doInitialize(
    assistant: AssistantUnrolled,
    authConfig: AuthConfig,
    agentFileServiceState: AgentFileServiceState | undefined,
  ): Promise<ModelServiceState> {
    logger.debug("ModelService.doInitialize called", {
      hasAssistant: !!assistant,
      hasAuthConfig: !!authConfig,
      assistantModelsCount: assistant?.models?.length || 0,
    });

    this.assistant = assistant;
    this.authConfig = authConfig;
    this.discoveredModels.clear();
    this.availableModels = (assistant.models?.filter(
      (model) =>
        model && (model.roles?.includes("chat") || model.roles === undefined),
    ) || []) as ModelConfig[];

    let preferredModelName: string | null | undefined = null;
    let persistedProfileId: string | null = null;
    let modelSource = "default";

    // Priority = agentFile -> last selected model
    if (agentFileServiceState?.agentFileModel?.name) {
      preferredModelName = agentFileServiceState.agentFileModel?.name;
      modelSource = "agentFile";
    } else {
      const persistedName = getModelName(authConfig);
      if (persistedName) {
        preferredModelName = persistedName;
        persistedProfileId = getPersistedModelProfileId();
        modelSource = "persisted";
      }
    }

    // Restore a discovered selection without making startup depend on the network.
    if (
      preferredModelName &&
      !this.availableModels.some(
        (model) =>
          model.name === preferredModelName &&
          (!persistedProfileId || modelProfileId(model) === persistedProfileId),
      )
    ) {
      const preferredId = preferredModelName;
      const configured = this.availableModels.find(
        (model) =>
          model.model === preferredModelName &&
          (!persistedProfileId || modelProfileId(model) === persistedProfileId),
      );
      const template = this.availableModels.find(
        (model) =>
          discoveryProviders.has(model.provider) &&
          (persistedProfileId
            ? modelProfileId(model) === persistedProfileId
            : model.provider !== "openai-compatible" &&
              discoverableChatModels(model.provider, [{ id: preferredId }])
                .length > 0),
      );
      if (configured) {
        preferredModelName = configured.name || configured.model;
      } else if (template) {
        const restored = this.discoveredModel(template, preferredModelName);
        this.availableModels.push(restored);
        assistant = {
          ...assistant,
          models: [...(assistant.models ?? []), restored],
        };
        this.assistant = assistant;
      }
    }

    // Try to use the preferred model (agent file or persisted)
    if (preferredModelName) {
      // During initialization, we need to check against availableModels directly
      const modelIndex = this.availableModels.findIndex((model) => {
        const name = (model as any).name || (model as any).model;
        return (
          name === preferredModelName &&
          (!persistedProfileId ||
            modelProfileId(this.discoveredModels.get(model) ?? model) ===
              persistedProfileId)
        );
      });
      if (modelIndex === -1) {
        // Preferred model not found, use default model selection
        const [llmApi, model] = getLlmApi(assistant, authConfig);
        return {
          llmApi,
          model,
          assistant,
          authConfig,
        };
      } else {
        // Use the preferred model - but we need to handle initialization specially
        // During init, currentState isn't set yet, so switchModel would fail
        // Instead, we'll manually switch here
        const selectedModel = this.availableModels[modelIndex];
        logger.debug(`Using ${modelSource} model during initialization`, {
          modelIndex,
          provider: selectedModel.provider,
          name: (selectedModel as any).name || "unnamed",
          modelSource,
        });

        const llmApi = createLlmApi(selectedModel, authConfig);
        if (!llmApi) {
          throw new Error(`Failed to initialize LLM with ${modelSource} model`);
        }

        return {
          llmApi,
          model: selectedModel,
          assistant,
          authConfig,
        };
      }
    } else {
      // Use default model selection
      const [llmApi, model] = getLlmApi(assistant, authConfig);
      return {
        llmApi,
        model,
        assistant,
        authConfig,
      };
    }
  }

  /**
   * Override isReady to check for required state
   */
  override isReady(): boolean {
    return (
      super.isReady() &&
      this.currentState.llmApi !== null &&
      this.currentState.model !== null
    );
  }

  /**
   * Get model information for display
   */
  getModelInfo(): { provider: string; name: string } | null {
    if (!this.currentState.model) {
      return null;
    }

    return {
      provider: this.currentState.model.provider,
      name: (this.currentState.model as any).name || "unnamed",
    };
  }

  /**
   * Get list of available chat models
   */
  getAvailableChatModels(): Array<{
    provider: string;
    name: string;
    index: number;
    discovered?: boolean;
  }> {
    // Get assistant from state to ensure we have the latest data
    const { assistant } = this.getState();
    if (!assistant || !assistant.models) {
      return [];
    }

    // Filter for chat models
    const chatModels = (assistant.models.filter(
      (model) =>
        model && (model.roles?.includes("chat") || model.roles === undefined),
    ) || []) as ModelConfig[];
    return chatModels.map((model, index) => ({
      provider: model.provider,
      name: (model as any).name || (model as any).model || "unnamed",
      index,
      ...(this.discoveredModels.has(model) ? { discovered: true } : {}),
    }));
  }

  private discoveredModel(template: ModelConfig, id: string): ModelConfig {
    const model: ModelConfig = {
      ...template,
      name: id,
      model: id,
      roles: ["chat"],
    };
    this.discoveredModels.set(
      model,
      this.discoveredModels.get(template) ?? template,
    );
    return model;
  }

  getCurrentModelProfile(): ModelConfig | null {
    const model = this.getState().model;
    return model ? (this.discoveredModels.get(model) ?? model) : null;
  }

  async discoverModels(): Promise<string | null> {
    const { assistant, model: template, authConfig } = this.getState();
    if (!assistant || !template || !discoveryProviders.has(template.provider)) {
      return null;
    }
    const providerNames: Record<string, string> = {
      openai: "OpenAI",
      anthropic: "Anthropic",
      gemini: "Gemini",
      "openai-compatible": "OpenAI-compatible",
    };
    const providerName = providerNames[template.provider] ?? template.provider;

    try {
      const api = createLlmApi(
        {
          ...template,
          requestOptions: {
            ...template.requestOptions,
            timeout: Math.min(
              template.requestOptions?.timeout ?? 10_000,
              10_000,
            ),
          },
        },
        authConfig,
      );
      if (!api) throw new Error("Provider could not be initialized");
      const catalog = await api.list();
      if (!Array.isArray(catalog)) throw new Error("Invalid model catalog");
      const ids = discoverableChatModels(template.provider, catalog);

      // A config reload while the request is pending must not restore old models.
      if (this.getState().assistant !== assistant) return null;
      if (ids.length === 0) {
        logger.warn("Model catalog contains no identifiable chat models", {
          provider: template.provider,
        });
        return `${providerName} catalog contains no identifiable chat models. Configure custom model IDs explicitly. Configured models remain available.`;
      }
      const defaultEndpoints: Record<string, string> = {
        openai: "https://api.openai.com/v1/",
        anthropic: "https://api.anthropic.com/v1/",
        gemini: "https://generativelanguage.googleapis.com/v1beta/",
      };
      const endpoint = (model: ModelConfig) =>
        (model.apiBase ?? defaultEndpoints[model.provider] ?? "").replace(
          /\/+$/,
          "",
        );
      const additions = ids
        .filter(
          (id) =>
            !assistant.models?.some(
              (model) =>
                model?.model === id &&
                model.provider === template.provider &&
                model.apiKey === template.apiKey &&
                endpoint(model) === endpoint(template) &&
                (model.roles === undefined || model.roles.includes("chat")),
            ),
        )
        .map((id) => this.discoveredModel(template, id));
      if (additions.length > 0) {
        const updated = {
          ...assistant,
          models: [...(assistant.models ?? []), ...additions],
        };
        this.assistant = updated;
        this.setState({ assistant: updated });
      }
      return null;
    } catch (error: unknown) {
      const status =
        error !== null &&
        typeof error === "object" &&
        "status" in error &&
        typeof error.status === "number"
          ? error.status
          : undefined;
      logger.warn("Model discovery failed", {
        provider: template.provider,
        status,
      });
      return `${providerName} model discovery failed${status ? ` (HTTP ${status})` : ""}. Check the provider connection, credentials, and model-listing support. Configured models remain available.`;
    }
  }

  /**
   * Switch to a different chat model by index
   */
  async switchModel(modelIndex: number): Promise<ModelServiceState> {
    // Get assistant and authConfig from state, but fall back to instance properties
    // This is needed during initialization when state isn't set yet
    const stateValues = this.getState();
    const assistant = stateValues.assistant || this.assistant;
    const authConfig = stateValues.authConfig || this.authConfig;

    // Debug logging to understand the state
    logger.debug("switchModel: Checking state", {
      hasStateAssistant: !!stateValues.assistant,
      hasStateAuthConfig: !!stateValues.authConfig,
      hasInstanceAssistant: !!this.assistant,
      hasInstanceAuthConfig: !!this.authConfig,
      isInitialized: this.isReady(),
      isReady: this.isReady(),
      modelIndex,
    });

    if (!assistant) {
      logger.error("switchModel: Missing assistant data", {
        assistant: !!assistant,
        authConfig: !!authConfig,
        stateKeys: Object.keys(stateValues),
        currentState: {
          hasLlmApi: !!stateValues.llmApi,
          hasModel: !!stateValues.model,
          hasAssistant: !!stateValues.assistant,
          hasAuthConfig: !!stateValues.authConfig,
        },
      });
      throw new Error("ModelService not initialized - assistant data missing");
    }

    // Get available models from assistant in state
    const availableModels = (assistant.models?.filter(
      (model) =>
        model && (model.roles?.includes("chat") || model.roles === undefined),
    ) || []) as ModelConfig[];

    if (modelIndex < 0 || modelIndex >= availableModels.length) {
      throw new Error(
        `Invalid model index: ${modelIndex}. Available models: 0-${availableModels.length - 1}`,
      );
    }

    const selectedModel = availableModels[modelIndex];
    logger.debug("Switching to model", {
      modelIndex,
      provider: selectedModel.provider,
      name: (selectedModel as any).name || "unnamed",
    });

    try {
      const llmApi = createLlmApi(selectedModel, authConfig);

      if (!llmApi) {
        throw new Error("Failed to initialize LLM with selected model");
      }

      this.setState({
        llmApi,
        model: selectedModel,
        assistant,
        authConfig,
      });

      logger.debug("Model switched successfully", {
        modelProvider: selectedModel.provider,
        modelName: (selectedModel as any).name || "unnamed",
      });

      return this.getState();
    } catch (error: any) {
      logger.error("Failed to switch model:", error);
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Get current model index
   */
  getCurrentModelIndex(): number {
    const state = this.getState();
    if (!state.model || !state.assistant) {
      return -1;
    }

    // Get available models from state
    const availableModels = (state.assistant.models?.filter(
      (model) =>
        model && (model.roles?.includes("chat") || model.roles === undefined),
    ) || []) as ModelConfig[];

    const exactIndex = availableModels.indexOf(state.model);
    if (exactIndex !== -1) return exactIndex;
    return availableModels.findIndex(
      (model) =>
        model.provider === state.model?.provider &&
        (model as any).name === (state.model as any).name,
    );
  }

  /**
   * Get model index by name and provider
   */
  getModelIndexByName(modelName: string, provider?: string): number {
    const state = this.getState();
    if (!state.assistant) {
      return -1;
    }

    // Get available models from state
    const availableModels = (state.assistant.models?.filter(
      (model) =>
        model && (model.roles?.includes("chat") || model.roles === undefined),
    ) || []) as ModelConfig[];

    return availableModels.findIndex((model) => {
      const name = (model as any).name || (model as any).model;
      const nameMatches = name === modelName;

      if (provider) {
        return nameMatches && model.provider === provider;
      }

      return nameMatches;
    });
  }

  static getSubagentModels(modelState: ModelServiceState) {
    if (!modelState.assistant) {
      return [];
    }
    const subagentModels = modelState.assistant.models
      ?.filter((model) => !!model)
      .filter((model) => !!model.name) // filter out models without a name
      .filter((model) => model.roles?.includes("subagent")) // filter with role subagent
      .filter((model) => !!model.chatOptions?.baseSystemMessage); // filter those with a system message

    if (!subagentModels) {
      return [];
    }
    return subagentModels?.map((model) => ({
      llmApi: createLlmApi(model, modelState.authConfig),
      model,
      assistant: modelState.assistant,
      authConfig: modelState.authConfig,
    }));
  }
}
