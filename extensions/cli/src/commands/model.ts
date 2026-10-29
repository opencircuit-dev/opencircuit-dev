import type { AssistantUnrolled as AssistantConfig } from "@opencircuit/config-yaml";
import chalk from "chalk";

import { services } from "../services/index.js";
import type { SlashCommandResult } from "../ui/hooks/useChat.types.js";
import { questionWithChoices } from "../util/prompt.js";

interface ModelChoice {
  input: string;
  label: string;
  modelIndex: number;
  name: string;
}

export function buildModelChoices(
  models: ReturnType<typeof services.model.getAvailableChatModels>,
  currentModelIndex: number,
): ModelChoice[] {
  return models.map((model, index) => ({
    input: String(index + 1),
    label: `${index + 1}. ${model.name} (${model.provider})${
      currentModelIndex === model.index ? " (current)" : ""
    }`,
    modelIndex: model.index,
    name: model.name,
  }));
}

/**
 * Handles the /model slash command.
 * Allows users to interactively switch between available chat models.
 */
export async function handleModelSlashCommand(
  _args: string[],
  _assistant: AssistantConfig,
): Promise<SlashCommandResult> {
  const modelService = services.model;

  try {
    const availableModels = modelService.getAvailableChatModels();

    if (availableModels.length === 0) {
      return {
        exit: false,
        output: chalk.red("No available chat models found."),
      };
    }

    const currentModelIndex = modelService.getCurrentModelIndex();
    const choices = buildModelChoices(availableModels, currentModelIndex);

    console.log(chalk.bold("Available chat models:"));
    for (const choice of choices) {
      console.log(`  ${choice.label}`);
    }

    const selectedInput = await questionWithChoices(
      "Select a chat model by number (q to cancel): ",
      [...choices.map((choice) => choice.input), "q"],
      undefined,
      "Invalid selection. Enter one of the listed numbers or q to cancel.",
    );

    if (selectedInput === "q") {
      return {
        exit: false,
        output: chalk.yellow("Model selection cancelled."),
      };
    }

    const selectedChoice = choices.find(
      (choice) => choice.input === selectedInput,
    );
    if (!selectedChoice) {
      return {
        exit: false,
        output: chalk.red(`Model not found: ${selectedInput}`),
      };
    }

    // Update current session model
    await modelService.switchModel(selectedChoice.modelIndex);

    return {
      exit: false,
      output: chalk.green(
        `Switched to model: ${chalk.bold(selectedChoice.name)}`,
      ),
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      exit: false,
      output: chalk.red(`Failed to switch model: ${message}`),
    };
  }
}
