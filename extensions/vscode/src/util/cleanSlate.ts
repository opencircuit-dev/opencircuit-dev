import fs from "fs";

import { getOCircuitGlobalPath } from "core/util/paths";
import { ExtensionContext } from "vscode";

/**
 * Clear all Continue-related artifacts to simulate a brand new user
 */
export function cleanSlate(context: ExtensionContext) {
  // Commented just to be safe
  // // Remove ~/.ocircuit
  // const ocircuitPath = getOCircuitGlobalPath();
  // if (fs.existsSync(ocircuitPath)) {
  //   fs.rmSync(ocircuitPath, { recursive: true, force: true });
  // }
  // // Clear extension's globalState
  // context.globalState.keys().forEach((key) => {
  //   context.globalState.update(key, undefined);
  // });
}
