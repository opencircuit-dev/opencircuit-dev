import { createHash } from "node:crypto";

import type { ModelConfig } from "@opencircuit/config-yaml";
import { GlobalContext } from "core/globalContext.js";

export function modelProfileId(model: ModelConfig): string {
  // Hash endpoint/auth settings so scoped persistence never stores credentials.
  return createHash("sha256")
    .update(
      JSON.stringify([
        model.provider,
        model.name,
        model.model,
        model.apiBase?.replace(/\/+$/, "") ?? "",
        model.apiKey ?? "",
        model.requestOptions,
        model.chatOptions,
        model.roles,
      ]),
    )
    .digest("hex");
}

export function getPersistedModelProfileId(): string | null {
  const context = new GlobalContext();
  const selection = context.get("cliSelectedModelProfile");
  // Older CLI sessions only update the name; do not reuse their stale scope.
  return selection?.name === context.get("cliSelectedModel")
    ? (selection?.profileId ?? null)
    : null;
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
    modelName && profile
      ? { name: modelName, profileId: modelProfileId(profile) }
      : undefined,
  );
}
