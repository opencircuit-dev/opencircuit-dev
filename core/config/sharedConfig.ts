import z from "zod";

import type {
  BrowserSerializedOCircuitConfig,
  Config,
  OCircuitConfig,
  SerializedOCircuitConfig,
} from "../index.js";

export const sharedConfigSchema = z
  .object({
    // boolean fields in config.json
    allowAnonymousTelemetry: z.boolean(),
    disableIndexing: z.boolean(),
    disableSessionTitles: z.boolean(),

    // `experimental` in `OCircuitConfig`
    useChromiumForDocsCrawling: z.boolean(),
    readResponseTTS: z.boolean(),
    promptPath: z.string(),
    useCurrentFileAsContext: z.boolean(),
    enableExperimentalTools: z.boolean(),
    onlyUseSystemMessageTools: z.boolean(),
    codebaseToolCallingOnly: z.boolean(),
    enableStaticContextualization: z.boolean(),

    // `ui` in `OCircuitConfig`
    showSessionTabs: z.boolean(),
    codeBlockToolbarPosition: z.enum(["top", "bottom"]),
    fontSize: z.number(),
    codeWrap: z.boolean(),
    displayRawMarkdown: z.boolean(),
    showChatScrollbar: z.boolean(),
    ocircuitAfterToolRejection: z.boolean(),

    // `tabAutocompleteOptions` in `OCircuitConfig`
    useAutocompleteCache: z.boolean(),
    useAutocompleteMultilineCompletions: z.enum(["always", "never", "auto"]),
    disableAutocompleteInFiles: z.array(z.string()),
    modelTimeout: z.number(),
    debounceDelay: z.number(),
  })
  .partial();

export type SharedConfigSchema = z.infer<typeof sharedConfigSchema>;

// For security in case of damaged config file, try to salvage any security-related values
export function salvageSharedConfig(sharedConfig: object): SharedConfigSchema {
  const salvagedConfig: SharedConfigSchema = {};
  if ("allowAnonymousTelemetry" in sharedConfig) {
    const val = z.boolean().safeParse(sharedConfig.allowAnonymousTelemetry);
    if (val.success) {
      salvagedConfig.allowAnonymousTelemetry = val.data;
    }
  }
  if ("disableIndexing" in sharedConfig) {
    const val = z.boolean().safeParse(sharedConfig.disableIndexing);
    if (val.success) {
      salvagedConfig.disableIndexing = val.data;
    }
  }
  if ("disableSessionTitles" in sharedConfig) {
    const val = z.boolean().safeParse(sharedConfig.disableSessionTitles);
    if (val.success) {
      salvagedConfig.disableSessionTitles = val.data;
    }
  }
  if ("disableAutocompleteInFiles" in sharedConfig) {
    const val = sharedConfigSchema.shape.disableAutocompleteInFiles.safeParse(
      sharedConfig.disableAutocompleteInFiles,
    );
    if (val.success) {
      salvagedConfig.disableAutocompleteInFiles = val.data;
    }
  }
  return salvagedConfig;
}

// Apply shared config to all forms of config
// - SerializedOCircuitConfig (config.json)
// - Config ("intermediate") - passed to config.ts
// - OCircuitConfig
// - BrowserSerializedOCircuitConfig (final converted to be passed to GUI)

// This modify function is split into two steps
// - rectifySharedModelsFromSharedConfig - includes boolean flags like allowAnonymousTelemetry which
//   must be added BEFORE config.ts and remote server config apply for JSON
//   for security reasons
// - setSharedModelsFromSharedConfig - exists because of selectedModelsByRole
//   Which don't exist on SerializedOCircuitConfig/Config types, so must be added after the fact
export function modifyAnyConfigWithSharedConfig<
  T extends
    | OCircuitConfig
    | BrowserSerializedOCircuitConfig
    | Config
    | SerializedOCircuitConfig,
>(ocircuitConfig: T, sharedConfig: SharedConfigSchema): T {
  const configCopy = { ...ocircuitConfig };
  configCopy.tabAutocompleteOptions = {
    ...configCopy.tabAutocompleteOptions,
  };
  if (sharedConfig.useAutocompleteCache !== undefined) {
    configCopy.tabAutocompleteOptions.useCache =
      sharedConfig.useAutocompleteCache;
  }
  if (sharedConfig.useAutocompleteMultilineCompletions !== undefined) {
    configCopy.tabAutocompleteOptions.multilineCompletions =
      sharedConfig.useAutocompleteMultilineCompletions;
  }
  if (sharedConfig.disableAutocompleteInFiles !== undefined) {
    configCopy.tabAutocompleteOptions.disableInFiles =
      sharedConfig.disableAutocompleteInFiles;
  }
  if (sharedConfig.modelTimeout !== undefined) {
    configCopy.tabAutocompleteOptions.modelTimeout = sharedConfig.modelTimeout;
  }
  if (sharedConfig.debounceDelay !== undefined) {
    configCopy.tabAutocompleteOptions.debounceDelay =
      sharedConfig.debounceDelay;
  }

  configCopy.ui = {
    ...configCopy.ui,
  };

  if (sharedConfig.codeBlockToolbarPosition !== undefined) {
    configCopy.ui.codeBlockToolbarPosition =
      sharedConfig.codeBlockToolbarPosition;
  }
  if (sharedConfig.fontSize !== undefined) {
    configCopy.ui.fontSize = sharedConfig.fontSize;
  }
  if (sharedConfig.codeWrap !== undefined) {
    configCopy.ui.codeWrap = sharedConfig.codeWrap;
  }
  if (sharedConfig.displayRawMarkdown !== undefined) {
    configCopy.ui.displayRawMarkdown = sharedConfig.displayRawMarkdown;
  }
  if (sharedConfig.showChatScrollbar !== undefined) {
    configCopy.ui.showChatScrollbar = sharedConfig.showChatScrollbar;
  }

  if (sharedConfig.allowAnonymousTelemetry !== undefined) {
    configCopy.allowAnonymousTelemetry = sharedConfig.allowAnonymousTelemetry;
  }
  if (sharedConfig.disableIndexing !== undefined) {
    configCopy.disableIndexing = sharedConfig.disableIndexing;
  }
  if (sharedConfig.disableSessionTitles !== undefined) {
    configCopy.disableSessionTitles = sharedConfig.disableSessionTitles;
  }

  if (sharedConfig.showSessionTabs !== undefined) {
    configCopy.ui.showSessionTabs = sharedConfig.showSessionTabs;
  }

  if (sharedConfig.ocircuitAfterToolRejection !== undefined) {
    configCopy.ui.ocircuitAfterToolRejection =
      sharedConfig.ocircuitAfterToolRejection;
  }

  configCopy.experimental = {
    ...configCopy.experimental,
  };

  if (sharedConfig.enableExperimentalTools !== undefined) {
    configCopy.experimental.enableExperimentalTools =
      sharedConfig.enableExperimentalTools;
  }

  if (sharedConfig.promptPath !== undefined) {
    configCopy.experimental.promptPath = sharedConfig.promptPath;
  }
  if (sharedConfig.useChromiumForDocsCrawling !== undefined) {
    configCopy.experimental.useChromiumForDocsCrawling =
      sharedConfig.useChromiumForDocsCrawling;
  }
  if (sharedConfig.readResponseTTS !== undefined) {
    configCopy.experimental.readResponseTTS = sharedConfig.readResponseTTS;
  }
  if (sharedConfig.useCurrentFileAsContext !== undefined) {
    configCopy.experimental.useCurrentFileAsContext =
      sharedConfig.useCurrentFileAsContext;
  }

  if (sharedConfig.onlyUseSystemMessageTools !== undefined) {
    configCopy.experimental.onlyUseSystemMessageTools =
      sharedConfig.onlyUseSystemMessageTools;
  }

  if (sharedConfig.codebaseToolCallingOnly !== undefined) {
    configCopy.experimental.codebaseToolCallingOnly =
      sharedConfig.codebaseToolCallingOnly;
  }
  if (sharedConfig.enableStaticContextualization !== undefined) {
    configCopy.experimental.enableStaticContextualization =
      sharedConfig.enableStaticContextualization;
  }

  return configCopy;
}
