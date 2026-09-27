import * as fs from "fs";
import * as path from "path";

import chalk from "chalk";
import { setConfigFilePermissions } from "core/paths.js";

import type { AuthConfig } from "./auth/workos.js";
import { getApiClient } from "./config.js";
import { loadConfiguration } from "./configLoader.js";
import { env } from "./env.js";
import {
  getApiKeyValidationError,
  isValidAnthropicApiKey,
} from "./util/apiKeyValidation.js";
import { question } from "./util/prompt.js";
import { updateAnthropicModelInYaml } from "./util/yamlConfigUpdater.js";

function getConfigPath(): string {
  return path.join(env.ocircuitHome, "config.yaml");
}

export async function checkHasAcceptableModel(
  configPath: string,
): Promise<boolean> {
  try {
    if (!fs.existsSync(configPath)) {
      return false;
    }

    const content = fs.readFileSync(configPath, "utf8");
    return content.includes("claude");
  } catch {
    return false;
  }
}

export async function createOrUpdateConfig(apiKey: string): Promise<void> {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const existingContent = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, "utf8")
    : "";

  const updatedContent = updateAnthropicModelInYaml(existingContent, apiKey);
  fs.writeFileSync(configPath, updatedContent);
  setConfigFilePermissions(configPath);
}

async function acceptExistingLocalConfig(
  authConfig: AuthConfig,
): Promise<boolean> {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    return false;
  }

  try {
    const loaded = await loadConfiguration(
      authConfig,
      configPath,
      getApiClient(undefined),
      [],
      false,
    );
    return Boolean(loaded.config.models?.length);
  } catch {
    return false;
  }
}

export async function runOnboardingFlow(
  configPath: string | undefined,
): Promise<boolean> {
  // Step 1: Check if --config flag is provided
  if (configPath !== undefined) {
    return false;
  }

  // Step 2: Check for OCIRCUIT_USE_BEDROCK environment variable first (before test env check)
  if (process.env.OCIRCUIT_USE_BEDROCK === "1") {
    console.log(
      chalk.blue("✓ Using AWS Bedrock (OCIRCUIT_USE_BEDROCK detected)"),
    );
    return true;
  }

  if (process.env.OCIRCUIT_API_KEY) {
    console.log(
      chalk.blue("✓ Using OCIRCUIT_API_KEY for Open Circuit API access"),
    );
    return true;
  }

  // Step 3: Check if we're in a test/CI environment - if so, skip interactive prompts
  const isTestEnv =
    process.env.NODE_ENV === "test" ||
    process.env.CI === "true" ||
    process.env.VITEST === "true" ||
    process.env.GITHUB_ACTIONS === "true" ||
    !process.stdin.isTTY;

  if (isTestEnv) {
    // In test/CI environment, check for ANTHROPIC_API_KEY first
    if (process.env.ANTHROPIC_API_KEY) {
      console.log(chalk.blue("✓ Using ANTHROPIC_API_KEY from environment"));
      await createOrUpdateConfig(process.env.ANTHROPIC_API_KEY);
      console.log(chalk.gray(`  Config saved to: ${getConfigPath()}`));
      return false;
    }

    // Otherwise return a minimal working configuration
    return false;
  }

  // Step 4: Prompt for API key
  console.log(chalk.yellow("To get started, enter your Anthropic API key."));

  const apiKey = await question(
    chalk.white("\nEnter your Anthropic API key: "),
  );

  if (!isValidAnthropicApiKey(apiKey)) {
    throw new Error(getApiKeyValidationError(apiKey));
  }

  await createOrUpdateConfig(apiKey);
  console.log(
    chalk.green(`✓ Config file updated successfully at ${getConfigPath()}`),
  );

  return true;
}

export async function isFirstTime(): Promise<boolean> {
  return !fs.existsSync(path.join(env.ocircuitHome, ".onboarding_complete"));
}

export async function markOnboardingComplete(): Promise<void> {
  const flagPath = path.join(env.ocircuitHome, ".onboarding_complete");
  const flagDir = path.dirname(flagPath);

  if (!fs.existsSync(flagDir)) {
    fs.mkdirSync(flagDir, { recursive: true });
  }

  fs.writeFileSync(flagPath, new Date().toISOString());
}

export async function initializeWithOnboarding(
  authConfig: AuthConfig,
  configPath: string | undefined,
) {
  const firstTime = await isFirstTime();

  if (configPath !== undefined) {
    // throw an early error is configPath is invalid or has errors
    try {
      await loadConfiguration(
        authConfig,
        configPath,
        getApiClient(undefined),
        [],
        false,
      );
    } catch (errorMessage) {
      throw new Error(
        `Failed to load config from "${configPath}": ${errorMessage}`,
      );
    }
  }

  if (!firstTime) return;

  if (
    configPath === undefined &&
    (await acceptExistingLocalConfig(authConfig))
  ) {
    await markOnboardingComplete();
    return;
  }

  const wasOnboarded = await runOnboardingFlow(configPath);
  if (wasOnboarded) {
    await markOnboardingComplete();
  }
}
