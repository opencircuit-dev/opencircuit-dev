import { vi } from "vitest";

export const getAllSlashCommands = vi.fn(async () => [
  { name: "help", description: "Show help", category: "system" },
  { name: "login", description: "Login to Open Circuit", category: "system" },
]);
