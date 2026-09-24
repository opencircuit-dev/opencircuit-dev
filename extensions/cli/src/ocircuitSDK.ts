import type { AssistantUnrolled } from "@opencircuit/config-yaml";
import {
  Continue as OCircuit,
  ContinueClient as OCircuitClient,
} from "@opencircuit/sdk";
import chalk from "chalk";

import { env } from "./env.js";

type LocalOCircuitClient = Omit<OCircuitClient, "assistant"> & {
  assistant: AssistantUnrolled;
};

/**
 * Initialize the Open Circuit SDK with the given parameters
 * @param apiKey - API key to use for authentication
 * @param assistantSlug - Slug of the assistant to use
 * @param organizationId - Optional organization ID
 * @returns Promise resolving to the Continue SDK instance
 */
export async function initializeOCircuitSDK(
  apiKey: string | undefined,
  assistantSlug: string,
  organizationId?: string,
): Promise<LocalOCircuitClient> {
  if (!apiKey) {
    console.error(chalk.red("Error: No API key provided for Open Circuit SDK"));
    throw new Error("No API key provided for Open Circuit SDK");
  }

  try {
    return (await OCircuit.from({
      apiKey,
      assistant: assistantSlug,
      organizationId,
      baseURL: env.apiBase,
    })) as unknown as LocalOCircuitClient;
  } catch (error) {
    console.error(
      chalk.red("Error initializing Open Circuit SDK:"),
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}
