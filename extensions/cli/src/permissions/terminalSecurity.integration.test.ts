import { describe, expect, it } from "vitest";

import { ToolPermissionService } from "../services/ToolPermissionService.js";
import { checkToolPermissionApproval } from "../stream/streamChatResponse.helpers.js";
import { runTerminalCommandTool } from "../tools/runTerminalCommand.js";

import { checkToolPermission } from "./permissionChecker.js";

describe("real terminal policy in auto and headless execution", () => {
  it.each(["auto", "normal"] as const)(
    "cannot override denial with --allow Bash in %s mode",
    async (mode) => {
      const service = new ToolPermissionService();
      service.initializeSync({ mode, isHeadless: true, allow: ["Bash"] });
      for (const command of [
        "$UNRESOLVED /",
        'CMD="rm -rf /"; $CMD',
        'sh -c "rm -rf /"',
        "env rm -rf /",
        "echo / | xargs rm -rf",
        'alias safe="rm -rf /"; safe',
        "function safe() { echo injected; }; safe",
        "chmod 755 /etc/passwd",
      ]) {
        const call = {
          id: "security-test",
          name: "Bash",
          arguments: { command },
          argumentsStr: JSON.stringify({ command }),
          startNotified: false,
          tool: runTerminalCommandTool,
        };
        const permissions = service.getState().permissions;
        expect(checkToolPermission(call, permissions).permission, command).toBe(
          "exclude",
        );
        expect(
          await checkToolPermissionApproval(permissions, call, undefined, true),
        ).toEqual({ approved: false, denialReason: "policy" });
        await expect(runTerminalCommandTool.run({ command })).rejects.toThrow(
          /denied by security policy/,
        );
      }
    },
  );

  it("requires real approval for executable code even in auto mode", async () => {
    const service = new ToolPermissionService();
    service.initializeSync({ mode: "auto", isHeadless: true, allow: ["Bash"] });
    const call = {
      id: "approval-test",
      name: "Bash",
      arguments: { command: "node app.js" },
      argumentsStr: '{"command":"node app.js"}',
      startNotified: false,
      tool: runTerminalCommandTool,
    };
    expect(
      checkToolPermission(call, service.getState().permissions).permission,
    ).toBe("ask");
    expect(
      await checkToolPermissionApproval(
        service.getState().permissions,
        call,
        undefined,
        true,
      ),
    ).toEqual({ approved: false, denialReason: "policy" });
    expect(
      checkToolPermission(
        { name: "Bash", arguments: { command: "pwd" } },
        service.getState().permissions,
      ).permission,
    ).toBe("allow");
  });
});
