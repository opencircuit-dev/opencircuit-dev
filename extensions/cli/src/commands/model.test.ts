import type { AssistantUnrolled as AssistantConfig } from "@opencircuit/config-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/index.js", () => ({
  services: {
    model: {
      getAvailableChatModels: vi.fn(),
      getCurrentModelIndex: vi.fn(),
      switchModel: vi.fn(),
    },
    config: {
      setSelectedModel: vi.fn(),
    },
  },
}));

vi.mock("../util/prompt.js", () => ({
  questionWithChoices: vi.fn(),
}));

import { services } from "../services/index.js";
import { questionWithChoices } from "../util/prompt.js";

import { buildModelChoices, handleModelSlashCommand } from "./model.js";

const assistant = {
  name: "test-assistant",
  version: "1.0.0",
} as AssistantConfig;

const getAvailableChatModels = vi.mocked(services.model.getAvailableChatModels);
const getCurrentModelIndex = vi.mocked(services.model.getCurrentModelIndex);
const switchModel = vi.mocked(services.model.switchModel);
const setSelectedModel = vi.mocked(services.config.setSelectedModel);
const askForChoice = vi.mocked(questionWithChoices);

describe("/model command", () => {
  let consoleLog: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLog.mockRestore();
  });

  it("builds visible, uniquely selectable choices for duplicate model names", () => {
    expect(
      buildModelChoices(
        [
          { provider: "openai", name: "Shared", index: 4 },
          { provider: "anthropic", name: "Shared", index: 9 },
        ],
        4,
      ),
    ).toEqual([
      {
        input: "1",
        label: "1. Shared (openai) (current)",
        modelIndex: 4,
        name: "Shared",
      },
      {
        input: "2",
        label: "2. Shared (anthropic)",
        modelIndex: 9,
        name: "Shared",
      },
    ]);
  });

  it("reports when no chat models are available", async () => {
    getAvailableChatModels.mockReturnValue([]);

    const result = await handleModelSlashCommand([], assistant);

    expect(result.output).toContain("No available chat models found.");
    expect(askForChoice).not.toHaveBeenCalled();
    expect(switchModel).not.toHaveBeenCalled();
  });

  it("prints choices and switches using the selected model index", async () => {
    getAvailableChatModels.mockReturnValue([
      { provider: "openai", name: "Shared", index: 4 },
      { provider: "anthropic", name: "Shared", index: 9 },
    ]);
    getCurrentModelIndex.mockReturnValue(4);
    askForChoice.mockResolvedValue("2");
    setSelectedModel.mockResolvedValue({ persisted: true });

    const result = await handleModelSlashCommand([], assistant);

    expect(consoleLog).toHaveBeenCalledWith("  1. Shared (openai) (current)");
    expect(consoleLog).toHaveBeenCalledWith("  2. Shared (anthropic)");
    expect(askForChoice).toHaveBeenCalledWith(
      "Select a chat model by number (q to cancel): ",
      ["1", "2", "q"],
      undefined,
      "Invalid selection. Enter one of the listed numbers or q to cancel.",
    );
    expect(switchModel).toHaveBeenCalledWith(9);
    expect(setSelectedModel).toHaveBeenCalledWith("Shared");
    expect(result.output).toContain("Switched to model: Shared");
  });

  it("reports a session-only switch when the preference cannot be saved", async () => {
    getAvailableChatModels.mockReturnValue([
      { provider: "openai", name: "GPT", index: 0 },
    ]);
    getCurrentModelIndex.mockReturnValue(0);
    askForChoice.mockResolvedValue("1");
    setSelectedModel.mockResolvedValue({
      persisted: false,
      error: new Error("permission denied"),
    });

    const result = await handleModelSlashCommand([], assistant);

    expect(switchModel).toHaveBeenCalledWith(0);
    expect(setSelectedModel).toHaveBeenCalledWith("GPT");
    expect(result.output).toContain("session only");
  });

  it("cancels without switching when the user enters q", async () => {
    getAvailableChatModels.mockReturnValue([
      { provider: "openai", name: "GPT", index: 0 },
    ]);
    getCurrentModelIndex.mockReturnValue(0);
    askForChoice.mockResolvedValue("q");

    const result = await handleModelSlashCommand([], assistant);

    expect(result.output).toContain("Model selection cancelled.");
    expect(switchModel).not.toHaveBeenCalled();
  });

  it("returns a user-facing error when switching fails", async () => {
    getAvailableChatModels.mockReturnValue([
      { provider: "openai", name: "GPT", index: 0 },
    ]);
    getCurrentModelIndex.mockReturnValue(0);
    askForChoice.mockResolvedValue("1");
    switchModel.mockRejectedValue(new Error("model unavailable"));

    const result = await handleModelSlashCommand([], assistant);

    expect(result.output).toContain(
      "Failed to switch model: model unavailable",
    );
  });
});
