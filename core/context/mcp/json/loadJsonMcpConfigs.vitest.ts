import { describe, expect, it, vi } from "vitest";
import { IDE } from "../../../index";
import { loadJsonMcpConfigs } from "./loadJsonMcpConfigs";

describe("loadJsonMcpConfigs", () => {
  it("keeps optional MCP discovery failures nonfatal", async () => {
    const ide = {
      getWorkspaceDirs: vi
        .fn<IDE["getWorkspaceDirs"]>()
        .mockRejectedValue(new Error("workspace discovery failed")),
    } as unknown as IDE;

    await expect(loadJsonMcpConfigs(ide, true)).resolves.toEqual({
      mcpServers: [],
      errors: [
        {
          fatal: false,
          message:
            "Failed to discover optional MCP server configurations. Other profile settings remain available.",
        },
      ],
    });
  });
});
