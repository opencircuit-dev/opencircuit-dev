import { GlobalContext } from "core/globalContext.js";
import { createHash } from "node:crypto";
import type { ModelConfig } from "@opencircuit/config-yaml";

export function modelProfileId(model: ModelConfig): string {
  // Hash endpoint/auth settings so scoped persistence never stores credentials.
  return createHash("sha256")
    .update(
      JSON.stringify([
        model.provider,
        model.name,
        model.apiBase?.replace(/\/+$/, "") ?? "",
        model.apiKey ?? "",
      ]),
    )
    .digest("hex");
}

export function getPersistedModelProfileId(): string | null {
  return new GlobalContext().get("cliSelectedModelProfile") ?? null;
}

/**
 * Get the persisted model name for CLI from GlobalContext
 * Used for unauthenticated users
 */
export function getPersistedModelName(): string | null {
  const globalContext = new GlobalContext();
  return globalContext.get("cliSelectedModel") ?? null;
}

/**
 * Persist the model name for CLI to GlobalContext
 * Used for unauthenticated users
 */
export function persistModelName(
  modelName: string | null,
  profile?: ModelConfig | null,
): void {
  const globalContext = new GlobalContext();
  globalContext.update("cliSelectedModel", modelName ?? undefined);
  globalContext.update(
    "cliSelectedModelProfile",
    modelName && profile ? modelProfileId(profile) : undefined,
  );
}
