import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkToolPermission } from "../permissions/permissionChecker.js";
import { runTerminalCommandTool } from "../tools/runTerminalCommand.js";

import {
  checkToolPermissionApproval,
  executeStreamedToolCalls,
} from "./streamChatResponse.helpers.js";

vi.mock("../services/index.js", () => ({
  services: {
    chatHistory: { addToolResult: vi.fn(), updateToolStatus: vi.fn() },
  },
  serviceContainer: {
    get: vi.fn(async () => ({
      permissions: { policies: [{ tool: "*", permission: "allow" }] },
    })),
  },
  SERVICE_NAMES: { TOOL_PERMISSIONS: "toolPermissions" },
}));
const permissions = { policies: [{ tool: "*", permission: "allow" as const }] };
const call = (command: string) => ({
  id: "blocked",
  name: "Bash",
  tool: runTerminalCommandTool,
  arguments: { command },
  argumentsStr: JSON.stringify({ command }),
  startNotified: false,
});

describe("phase 1: explain an existing policy denial without executing it", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([
    "echo -e '===== severity.txt =====\\nmedium' | sudo tee /tmp/project/config/rul-000010/severity.txt",
    "echo -e '===== severity.txt =====\\nmedium' | sudo tee /tmp/projct/config/rule-000010/severity.txt",
    "/usr/bin/sudo tee /tmp/severity.txt",
  ])("explains privilege escalation in %s", async (command) => {
    const input = call(command);
    expect(checkToolPermission(input, permissions).permission).toBe("exclude");
    const result = await checkToolPermissionApproval(
      permissions,
      input,
      undefined,
      false,
    );
    expect(result).toMatchObject({
      approved: false,
      denialReason: "policy",
      denialMessage: expect.stringContaining(
        "Privilege escalation (sudo) is prohibited",
      ),
    });
    const run = vi.spyOn(runTerminalCommandTool, "run");
    const executed = await executeStreamedToolCalls([input]);
    expect(run).not.toHaveBeenCalled();
    expect(executed.chatHistoryEntries[0].content).toContain(
      "This command did not execute",
    );
    expect(executed.chatHistoryEntries[0].content).not.toContain("medium");
    run.mockRestore();
  });
  it("does not label a quoted word or configured exclusion as privilege escalation", async () => {
    const excluded = {
      policies: [{ tool: "Bash", permission: "exclude" as const }],
    };
    const result = await checkToolPermissionApproval(
      excluded,
      call("echo 'sudo'"),
    );
    expect(result).toMatchObject({ approved: false, denialReason: "policy" });
    expect(result.denialMessage).not.toContain("Privilege escalation");
    expect(
      await checkToolPermissionApproval(permissions, call("echo 'sudo'")),
    ).toEqual({ approved: true });
  });
});
