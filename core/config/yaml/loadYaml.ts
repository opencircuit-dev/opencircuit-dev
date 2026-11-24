import {
  AssistantUnrolled,
  AssistantUnrolledNonNullable,
  BLOCK_TYPES,
  ConfigResult,
  ConfigValidationError,
  mergeConfigYamlRequestOptions,
  mergeUnrolledAssistants,
  ModelRole,
  PackageIdentifier,
  RegistryClient,
  unrollAssistant,
  validateConfigYaml,
} from "@opencircuit/config-yaml";
import { dirname } from "node:path";

import {
  OCircuitConfig,
  IDE,
  IdeInfo,
  IdeSettings,
  ILLMLogger,
  InternalMcpOptions,
} from "../..";
import { MCPManagerSingleton } from "../../context/mcp/MCPManagerSingleton";
import TransformersJsEmbeddingsProvider from "../../llm/llms/TransformersJsEmbeddingsProvider";
import { getAllPromptFiles } from "../../promptFiles/getPromptFiles";
import { GlobalContext } from "../../util/GlobalContext";
import { modifyAnyConfigWithSharedConfig } from "../sharedConfig";

import { convertPromptBlockToSlashCommand } from "../../commands/slash/promptBlockSlashCommand";
import { slashCommandFromPromptFile } from "../../commands/slash/promptFileSlashCommand";
import { loadJsonMcpConfigs } from "../../context/mcp/json/loadJsonMcpConfigs";
import { getBaseToolDefinitions } from "../../tools";
import { getCleanUriPath } from "../../util/uri";
import { loadConfigContextProviders } from "../loadContextProviders";
import { getAllDotOCircuitDefinitionFiles } from "../loadLocalAssistants";
import { unrollLocalYamlBlocks } from "./loadLocalYamlBlocks";
import { LocalPlatformClient } from "./LocalPlatformClient";
import { llmsFromModelConfig } from "./models";
import {
  convertYamlMcpConfigToInternalMcpOptions,
  convertYamlRuleToOCircuitRule,
} from "./yamlToOCircuitConfig";

async function withConfigLoadStage<T>(
  stage: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const failure =
      error instanceof Error ? error : new Error("Config load failed");
    const diagnostics = failure as Error & {
      diagnosticCategory?: string;
      diagnosticCode?: string;
      diagnosticPath?: string;
    };
    diagnostics.diagnosticCategory ??= "config_resolution";
    diagnostics.diagnosticCode ??= "profile_load_error";
    diagnostics.diagnosticPath ??= stage;
    throw failure;
  }
}

function tagFatalConfigErrors(
  errors: ConfigValidationError[],
  stage: string,
): ConfigValidationError[] {
  return errors.map((error) => {
    if (!error.fatal) {
      return error;
    }
    const diagnostic = error as ConfigValidationError & {
      diagnosticCategory?:
        | "schema_validation"
        | "model_validation"
        | "config_resolution"
        | "other";
      diagnosticCode?:
        | "invalid_type"
        | "unrecognized_keys"
        | "invalid_union"
        | "invalid_value"
        | "too_small"
        | "too_big"
        | "invalid_format"
        | "other";
      diagnosticPath?: string;
    };
    return {
      ...error,
      diagnosticCategory: diagnostic.diagnosticCategory ?? "config_resolution",
      diagnosticCode: diagnostic.diagnosticCode ?? "other",
      diagnosticPath: diagnostic.diagnosticPath ?? stage,
    };
  });
}

async function loadConfigYaml(options: {
  overrideConfigYaml: AssistantUnrolled | undefined;
  ideSettings: IdeSettings;
  ide: IDE;
  packageIdentifier: PackageIdentifier;
}): Promise<ConfigResult<AssistantUnrolled>> {
  const { overrideConfigYaml, ideSettings, ide, packageIdentifier } = options;

  // Add local .ocircuit blocks
  // Use "content" field to pass pre-read content directly, avoiding
  // fs.readFileSync which fails for remote:// URIs in WSL (#6242, #7810)
  const localBlockPromises = BLOCK_TYPES.map(async (blockType) => {
    const localBlocks = await getAllDotOCircuitDefinitionFiles(
      ide,
      { includeGlobal: true, includeWorkspace: true, fileExtType: "yaml" },
      blockType,
    );
    return localBlocks.map((b) => ({
      uriType: "file" as const,
      fileUri: b.path,
      content: b.content,
    }));
  });
  const localPackageIdentifiers: PackageIdentifier[] =
    await withConfigLoadStage("yaml_local_blocks", async () =>
      (await Promise.all(localBlockPromises)).flat(),
    );

  // Registry client is only used if local blocks are present, but logic same for hub/local assistants
  const getRegistryClient = async () => {
    const rootPath =
      packageIdentifier.uriType === "file"
        ? dirname(getCleanUriPath(packageIdentifier.fileUri))
        : undefined;
    return new RegistryClient({
      rootPath,
    });
  };

  const errors: ConfigValidationError[] = [];

  let config: AssistantUnrolled | undefined;

  if (overrideConfigYaml) {
    config = overrideConfigYaml;
    if (localPackageIdentifiers.length > 0) {
      const unrolledLocal = await unrollLocalYamlBlocks(
        localPackageIdentifiers,
        ide,
        await getRegistryClient(),
      );
      if (unrolledLocal.errors) {
        errors.push(
          ...tagFatalConfigErrors(unrolledLocal.errors, "yaml_local_blocks"),
        );
      }
      if (unrolledLocal.config) {
        config = mergeUnrolledAssistants(config, unrolledLocal.config);
      }
    }
  } else {
    // This is how we allow use of blocks locally
    const unrollResult = await withConfigLoadStage("yaml_unroll", async () =>
      unrollAssistant(packageIdentifier, await getRegistryClient(), {
        renderSecrets: true,
        currentUserSlug: "",
        platformClient: new LocalPlatformClient(ide),
        injectBlocks: localPackageIdentifiers,
      }),
    );
    config = unrollResult.config;
    if (unrollResult.errors) {
      errors.push(...tagFatalConfigErrors(unrollResult.errors, "yaml_unroll"));
    }
  }

  if (config) {
    errors.push(...validateConfigYaml(nonNullifyConfigYaml(config)));
  }

  if (errors?.some((error) => error.fatal)) {
    return {
      errors,
      config: undefined,
      configLoadInterrupted: true,
    };
  }

  // Set defaults if undefined (this lets us keep config.json uncluttered for new users)
  return {
    config,
    errors,
    configLoadInterrupted: false,
  };
}

function nonNullifyConfigYaml(
  unrolledAssistant: AssistantUnrolled,
): AssistantUnrolledNonNullable {
  return {
    ...unrolledAssistant,
    data: unrolledAssistant.data?.filter((k) => !!k),
    context: unrolledAssistant.context?.filter((k) => !!k),
    docs: unrolledAssistant.docs?.filter((k) => !!k),
    mcpServers: unrolledAssistant.mcpServers?.filter((k) => !!k),
    models: unrolledAssistant.models?.filter((k) => !!k),
    prompts: unrolledAssistant.prompts?.filter((k) => !!k),
    rules: unrolledAssistant.rules?.filter((k) => !!k).map((k) => k!),
  };
}

export async function configYamlToOCircuitConfig(options: {
  unrolledAssistant: AssistantUnrolled;
  ide: IDE;
  ideInfo: IdeInfo;
  uniqueId: string;
  llmLogger: ILLMLogger;
}): Promise<{ config: OCircuitConfig; errors: ConfigValidationError[] }> {
  let { unrolledAssistant, ide, ideInfo, uniqueId, llmLogger } = options;

  const localErrors: ConfigValidationError[] = [];

  const ocircuitConfig: OCircuitConfig = {
    slashCommands: [],
    tools: getBaseToolDefinitions(),
    mcpServerStatuses: [],
    contextProviders: [],
    modelsByRole: {
      chat: [],
      edit: [],
      apply: [],
      embed: [],
      autocomplete: [],
      rerank: [],
      summarize: [],
      subagent: [],
    },
    selectedModelByRole: {
      chat: null,
      edit: null, // not currently used
      apply: null,
      embed: null,
      autocomplete: null,
      rerank: null,
      summarize: null,
      subagent: null,
    },
    rules: [],
    requestOptions: { ...unrolledAssistant.requestOptions },
  };

  const config = nonNullifyConfigYaml(unrolledAssistant);

  for (const rule of config.rules ?? []) {
    const convertedRule = convertYamlRuleToOCircuitRule(rule);
    ocircuitConfig.rules.push(convertedRule);
  }

  ocircuitConfig.data = config.data?.map((d) => ({
    ...d,
    requestOptions: mergeConfigYamlRequestOptions(
      d.requestOptions,
      ocircuitConfig.requestOptions,
    ),
  }));
  ocircuitConfig.docs = config.docs?.map((doc) => ({
    title: doc.name,
    startUrl: doc.startUrl,
    rootUrl: doc.rootUrl,
    faviconUrl: doc.faviconUrl,
    useLocalCrawling: doc.useLocalCrawling,
    sourceFile: doc.sourceFile,
  }));

  // Prompt files -
  try {
    const promptFiles = await withConfigLoadStage(
      "yaml_runtime_conversion.prompt_files",
      () => getAllPromptFiles(ide, undefined, true),
    );

    promptFiles.forEach((file) => {
      try {
        const slashCommand = slashCommandFromPromptFile(
          file.path,
          file.content,
        );
        if (slashCommand) {
          ocircuitConfig.slashCommands?.push(slashCommand);
        }
      } catch (e) {
        // If the file is in a rules directory, we can provide a more helpful error message
        // because we know it's likely a rule definition
        const isRuleFile =
          file.path.toLowerCase().includes("/rules/") ||
          file.path.toLowerCase().includes("\\rules\\");

        let message = `Failed to convert prompt file ${file.path} to slash command: ${e instanceof Error ? e.message : e}`;

        if (isRuleFile) {
          const isYamlError =
            e instanceof Error &&
            (e.name?.includes("YAML") || e.message.includes("flow sequence"));

          const prefix = isYamlError
            ? "Failed to parse rule definition"
            : "Failed to process rule definition";

          const errorDetails = e instanceof Error ? e.message : String(e);
          message = `${prefix} ${file.path}: ${errorDetails}`;
        }

        localErrors.push({
          fatal: false,
          message,
        });
      }
    });
  } catch (e) {
    localErrors.push({
      fatal: false,
      message: `Error loading local prompt files: ${e instanceof Error ? e.message : e}`,
    });
  }

  config.prompts?.forEach((prompt) => {
    try {
      const slashCommand = convertPromptBlockToSlashCommand(prompt);
      ocircuitConfig.slashCommands?.push(slashCommand);
    } catch (e) {
      localErrors.push({
        message: `Error loading prompt ${prompt.name}: ${e instanceof Error ? e.message : e}`,
        fatal: false,
      });
    }
  });

  // Models
  const defaultModelRoles: ModelRole[] = ["chat", "summarize", "apply", "edit"];
  for (const model of config.models ?? []) {
    model.roles = model.roles ?? defaultModelRoles; // Default to all 4 chat-esque roles if not specified

    try {
      const llms = await llmsFromModelConfig({
        model,
        uniqueId,
        llmLogger,
        config: ocircuitConfig,
      });

      if (model.roles?.includes("chat")) {
        ocircuitConfig.modelsByRole.chat.push(...llms);
      }

      if (model.roles?.includes("summarize")) {
        ocircuitConfig.modelsByRole.summarize.push(...llms);
      }

      if (model.roles?.includes("apply")) {
        ocircuitConfig.modelsByRole.apply.push(...llms);
      }

      if (model.roles?.includes("edit")) {
        ocircuitConfig.modelsByRole.edit.push(...llms);
      }

      if (model.roles?.includes("autocomplete")) {
        ocircuitConfig.modelsByRole.autocomplete.push(...llms);
      }

      if (model.roles?.includes("embed")) {
        const { provider } = model;
        if (provider === "transformers.js") {
          ocircuitConfig.modelsByRole.embed.push(
            new TransformersJsEmbeddingsProvider(),
          );
        } else {
          ocircuitConfig.modelsByRole.embed.push(...llms);
        }
      }

      if (model.roles?.includes("rerank")) {
        ocircuitConfig.modelsByRole.rerank.push(...llms);
      }

      if (model.roles?.includes("subagent")) {
        ocircuitConfig.modelsByRole.subagent.push(...llms);
      }
    } catch (e) {
      localErrors.push({
        fatal: false,
        message: `Failed to load model:\nName: ${model.name}\nModel: ${model.model}\nProvider: ${model.provider}\n${e instanceof Error ? e.message : e}`,
      });
    }
  }

  const { providers, errors: contextErrors } = await withConfigLoadStage(
    "yaml_runtime_conversion.context_providers",
    () =>
      loadConfigContextProviders(
        config.context,
        !!config.docs?.length,
        ideInfo.ideType,
      ),
  );

  ocircuitConfig.contextProviders = providers;
  localErrors.push(...contextErrors);

  // Trigger MCP server refreshes (Config is reloaded again once connected!)
  const mcpManager = MCPManagerSingleton.getInstance();

  const mcpOptions: InternalMcpOptions[] = (config.mcpServers ?? []).map(
    (server) =>
      convertYamlMcpConfigToInternalMcpOptions(server, config.requestOptions),
  );
  const { errors: jsonMcpErrors, mcpServers } = await withConfigLoadStage(
    "yaml_runtime_conversion.json_mcp",
    () => loadJsonMcpConfigs(ide, true, config.requestOptions),
  );
  localErrors.push(...jsonMcpErrors);
  mcpOptions.push(...mcpServers);
  await withConfigLoadStage("yaml_runtime_conversion.mcp_registration", () =>
    mcpManager.setConnections(mcpOptions, false, { ide }),
  );

  return { config: ocircuitConfig, errors: localErrors };
}

export async function loadOCircuitConfigFromYaml(options: {
  ide: IDE;
  ideSettings: IdeSettings;
  ideInfo: IdeInfo;
  uniqueId: string;
  llmLogger: ILLMLogger;
  overrideConfigYaml: AssistantUnrolled | undefined;
  packageIdentifier: PackageIdentifier;
}): Promise<ConfigResult<OCircuitConfig>> {
  const {
    ide,
    ideSettings,
    ideInfo,
    uniqueId,
    llmLogger,
    overrideConfigYaml,
    packageIdentifier,
  } = options;

  const configYamlResult = await withConfigLoadStage("yaml_unroll", () =>
    loadConfigYaml({
      overrideConfigYaml,
      ideSettings,
      ide,
      packageIdentifier,
    }),
  );

  const unrolledAssistant = configYamlResult.config;
  if (!unrolledAssistant || configYamlResult.configLoadInterrupted) {
    return {
      errors: configYamlResult.errors,
      config: undefined,
      configLoadInterrupted: true,
      configName: configYamlResult.configName,
    };
  }

  const { config: ocircuitConfig, errors: localErrors } =
    await withConfigLoadStage("yaml_runtime_conversion", () =>
      configYamlToOCircuitConfig({
        unrolledAssistant,
        ide,
        ideInfo,
        uniqueId,
        llmLogger,
      }),
    );

  // Apply shared config
  // TODO: override several of these values with user/org shared config
  // Don't try catch this - has security implications and failure should be fatal
  const withShared = await withConfigLoadStage("yaml_shared_merge", () => {
    const sharedConfig = new GlobalContext().getSharedConfig();
    return modifyAnyConfigWithSharedConfig(ocircuitConfig, sharedConfig);
  });
  if (withShared.allowAnonymousTelemetry === undefined) {
    withShared.allowAnonymousTelemetry = true;
  }

  return {
    config: withShared,
    errors: [...(configYamlResult.errors ?? []), ...localErrors],
    configLoadInterrupted: false,
    configName: configYamlResult.configName,
  };
}
