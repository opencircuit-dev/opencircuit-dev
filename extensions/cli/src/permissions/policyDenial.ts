import * as path from "node:path";

import { evaluateTerminalCommandSecurity } from "@opencircuit/terminal-security";
import { parse } from "shell-quote";

import type { ToolCallRequest } from "./types.js";

/** Explain only recognized reasons, without echoing command contents or secrets. */
export function policyDenialMessage(call: ToolCallRequest): string {
  const generic =
    "Command blocked by security policy. This command did not execute. Do not retry or bypass the denial; report the block to the user.";
  if (call.name !== "Bash" || typeof call.arguments.command !== "string")
    return generic;
  const command = call.arguments.command;
  if (
    evaluateTerminalCommandSecurity("allowedWithoutPermission", command) !==
    "disabled"
  )
    return generic;
  try {
    let commandStart = true;
    for (const token of parse(command)) {
      if (typeof token !== "string") {
        if ("op" in token && ["|", ";", "&&", "||", "&"].includes(token.op))
          commandStart = true;
        continue;
      }
      if (!commandStart) continue;
      commandStart = false;
      const name = path.posix
        .basename(token.replaceAll("\\", "/"))
        .toLowerCase();
      if (["sudo", "su", "doas", "runas", "gsudo", "psexec"].includes(name)) {
        return `Command blocked by security policy. Privilege escalation (${name}) is prohibited. This command did not execute. Do not retry or bypass the denial; report the block to the user.`;
      }
    }
  } catch {
    /* Unrecognized syntax retains the generic denial. */
  }
  return generic;
}
