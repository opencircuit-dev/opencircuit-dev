import { Command } from "commander";

import {
  AgentHost,
  CoreHistorySessionBackend,
  runStdioHost,
  type CoreHistoryStore,
} from "@opencircuit/agent-host";
import historyManager from "core/util/history.js";

export function agentCommand(): Command {
  const agent = new Command("agent").description(
    "Run or connect to an Agent Host Protocol endpoint",
  );
  agent
    .command("host")
    .description("Run the Open Circuit Agent Host Protocol server over stdio")
    .action(async () => {
      const backend = new CoreHistorySessionBackend(
        historyManager as unknown as CoreHistoryStore,
      );
      await runStdioHost(new AgentHost({ backend }));
    });
  return agent;
}
