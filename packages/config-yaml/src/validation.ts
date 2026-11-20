import { ConfigYaml, configYamlSchema } from "./schemas/index.js";

export interface ConfigValidationError {
  fatal: boolean;
  message: string;
  uri?: string;
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
}

export interface ConfigValidationDiagnostic {
  diagnosticCategory: "schema_validation";
  diagnosticCode:
    | "invalid_type"
    | "unrecognized_keys"
    | "invalid_union"
    | "invalid_value"
    | "too_small"
    | "too_big"
    | "invalid_format"
    | "other";
  diagnosticPath: string;
}

export interface ConfigResult<T> {
  config: T | undefined;
  errors: ConfigValidationError[] | undefined;
  configLoadInterrupted: boolean;
  /** Optional display name from config.yaml `name` field */
  configName?: string;
}

function containsUnicode(str: string): boolean {
  return /[^\x00-\x7F]/.test(str);
}

function mostSpecificValidationIssue(issue: any): any {
  if (issue?.code === "invalid_union" && Array.isArray(issue.errors)) {
    for (const branch of issue.errors) {
      if (Array.isArray(branch) && branch.length > 0) {
        return mostSpecificValidationIssue(branch[0]);
      }
    }
  }
  return issue;
}

/** Convert a Zod issue into bounded metadata without retaining issue messages or values. */
export function getConfigValidationDiagnostic(
  rootIssue: any,
): ConfigValidationDiagnostic {
  const issue = mostSpecificValidationIssue(rootIssue);
  const issuePath = Array.isArray(issue?.path) ? issue.path : [];
  const rootPath = Array.isArray(rootIssue?.path) ? rootIssue.path : [];
  const fullIssuePath =
    rootIssue !== issue && rootPath.length > 0 && issuePath[0] !== rootPath[0]
      ? [...rootPath, ...issuePath]
      : issuePath;
  const allowedPathParts = new Set([
    "name",
    "version",
    "schema",
    "metadata",
    "models",
    "provider",
    "model",
    "apiBase",
    "apiKey",
    "roles",
    "capabilities",
    "contextLength",
    "maxStopWords",
    "defaultCompletionOptions",
    "cacheBehavior",
    "requestOptions",
    "embedOptions",
    "chatOptions",
    "disableTools",
    "baseSystemMessage",
    "baseAgentSystemMessage",
    "basePlanSystemMessage",
    "toolOverrides",
    "promptTemplates",
    "useLegacyCompletionsEndpoint",
    "useResponsesApi",
    "env",
    "autocompleteOptions",
  ]);
  const diagnosticPath =
    fullIssuePath.length > 0
      ? fullIssuePath
          .map((part: unknown) => {
            if (
              typeof part === "number" &&
              Number.isSafeInteger(part) &&
              part >= 0
            ) {
              return `[${part}]`;
            }
            return typeof part === "string" && allowedPathParts.has(part)
              ? part
              : "field";
          })
          .join(".")
          .replace(/\.\[/g, "[")
      : "";
  const knownCodes = new Set([
    "invalid_type",
    "unrecognized_keys",
    "invalid_union",
    "invalid_value",
    "too_small",
    "too_big",
    "invalid_format",
  ]);
  return {
    diagnosticCategory: "schema_validation",
    diagnosticCode: knownCodes.has(issue?.code) ? issue.code : "other",
    diagnosticPath,
  };
}

export function validateConfigYaml(
  config: ConfigYaml,
): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  try {
    configYamlSchema.parse(config);
  } catch (e: any) {
    return [
      {
        fatal: true,
        message: e.message,
        ...getConfigValidationDiagnostic(
          Array.isArray(e?.issues) ? e.issues[0] : undefined,
        ),
      },
    ];
  }

  config.models?.forEach((model) => {
    if ("uses" in model) {
      return;
    }

    // request headers to the llm api should not contain unicode characters
    if (model.apiKey && containsUnicode(model.apiKey)) {
      errors.push({
        fatal: true,
        message: `Model "${model.name}" has an API key containing unicode characters. API keys should only contain ASCII characters.`,
        diagnosticCategory: "model_validation",
        diagnosticCode: "other",
        diagnosticPath: "models.apiKey",
      });
    }

    if (model.requestOptions?.headers) {
      for (const [key, value] of Object.entries(model.requestOptions.headers)) {
        if (containsUnicode(key) || containsUnicode(value)) {
          errors.push({
            fatal: true,
            message: `Model "${model.name}" has a request header "${key}" containing unicode characters. Request headers should only contain ASCII characters.`,
            diagnosticCategory: "model_validation",
            diagnosticCode: "other",
            diagnosticPath: "models.requestOptions.headers",
          });
        }
      }
    }
    // Max tokens not too close to context length
    const effectiveContextLength =
      model.contextLength ?? model.defaultCompletionOptions?.contextLength;
    const effectiveMaxTokens = model.defaultCompletionOptions?.maxTokens;
    if (effectiveContextLength && effectiveMaxTokens) {
      const difference = effectiveContextLength - effectiveMaxTokens;

      if (difference < 1000) {
        errors.push({
          fatal: false,
          message: `Model "${model.name}" has a contextLength of ${effectiveContextLength} and a maxTokens of ${effectiveMaxTokens}. This leaves only ${difference} tokens for input context and will likely result in your inputs being truncated.`,
        });
      }
    }

    if (model.roles?.includes("autocomplete")) {
      const modelName = model.model.toLocaleLowerCase();
      const nonAutocompleteModels = [
        // "gpt",
        // "claude",
        "mistral",
        "instruct",
      ];

      if (
        nonAutocompleteModels.some((m) => modelName.includes(m)) &&
        !modelName.includes("deepseek") &&
        !modelName.includes("codestral") &&
        !modelName.toLowerCase().includes("coder")
      ) {
        errors.push({
          fatal: false,
          message: `${model.model} is not trained for tab-autocomplete, and will result in low-quality suggestions. See the docs to learn more about why: //features/tab-autocomplete#i-want-better-completions-should-i-use-gpt-4`,
        });
      }
    }
  });

  return errors;
}
