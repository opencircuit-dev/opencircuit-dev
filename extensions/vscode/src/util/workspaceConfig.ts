import { workspace } from "vscode";

export const OCIRCUIT_WORKSPACE_KEY = "continue";

export function getOCircuitWorkspaceConfig() {
  return workspace.getConfiguration(OCIRCUIT_WORKSPACE_KEY);
}
