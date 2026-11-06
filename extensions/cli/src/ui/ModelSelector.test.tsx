import { render } from "ink-testing-library";
import React, { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  available: vi.fn(),
  currentIndex: vi.fn(),
  discover: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  services: {
    model: {
      getAvailableChatModels: mocks.available,
      getCurrentModelIndex: mocks.currentIndex,
      discoverModels: mocks.discover,
    },
  },
}));

import { ModelSelector } from "./ModelSelector.js";

describe("ModelSelector discovery", () => {
  const configured = { provider: "openai", name: "Configured GPT", index: 0 };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.available.mockReturnValue([configured]);
    mocks.currentIndex.mockReturnValue(0);
    mocks.discover.mockResolvedValue(null);
  });

  it("keeps configured models selectable after discovery fails", async () => {
    mocks.discover.mockResolvedValue(
      "Discovery unavailable; configured models remain available.",
    );
    const onSelect = vi.fn();
    const { lastFrame, stdin } = render(
      <ModelSelector onSelect={onSelect} onCancel={vi.fn()} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Discovery unavailable");
      expect(lastFrame()).toContain("Configured GPT (openai) (configured)");
    });
    await act(async () => {});
    stdin.write("\r");
    await vi.waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Configured GPT", index: 0 }),
      ),
    );
  });

  it("labels discovered entries and scrolls to selectable models beyond the visible window", async () => {
    const models = [
      configured,
      ...Array.from({ length: 24 }, (_, offset) => ({
        provider: "openai",
        name: `Discovered ${offset + 1}`,
        index: offset + 1,
        discovered: true,
      })),
    ];
    mocks.discover.mockImplementation(async () => {
      mocks.available.mockReturnValue(models);
      return null;
    });
    const onSelect = vi.fn();
    const { lastFrame, stdin } = render(
      <ModelSelector onSelect={onSelect} onCancel={vi.fn()} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Discovered 1 (openai) (discovered)");
      expect(lastFrame()).not.toContain("Discovered 24");
      expect(lastFrame()).not.toContain("discovering...");
    });
    await act(async () => {});
    stdin.write("\u001b[A");
    await vi.waitFor(() =>
      expect(lastFrame()).toContain("Discovered 24 (openai) (discovered)"),
    );
    stdin.write("\r");
    await vi.waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Discovered 24", index: 24 }),
      ),
    );
  });

  it("does not reset navigation when a pending discovery completes", async () => {
    const second = { ...configured, name: "Second configured", index: 1 };
    const third = {
      ...configured,
      name: "Discovered third",
      index: 2,
      discovered: true,
    };
    mocks.available.mockReturnValue([configured, second]);
    let finish: ((warning: string | null) => void) | undefined;
    mocks.discover.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          finish = resolve;
        }),
    );
    const onSelect = vi.fn();
    const { lastFrame, stdin } = render(
      <ModelSelector onSelect={onSelect} onCancel={vi.fn()} />,
    );
    await vi.waitFor(() => expect(lastFrame()).toContain("Second configured"));
    await act(async () => {});
    stdin.write("\u001b[B");
    await vi.waitFor(() =>
      expect(lastFrame()).toContain("\u27a4 Second configured"),
    );
    mocks.available.mockReturnValue([configured, second, third]);
    if (!finish) throw new Error("Discovery did not start");
    finish(null);
    await vi.waitFor(() => expect(lastFrame()).toContain("Discovered third"));
    await act(async () => {});
    stdin.write("\r");
    await vi.waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Second configured", index: 1 }),
      ),
    );
  });

  it("qualifies duplicate names by provider and selects the current model", async () => {
    mocks.available.mockReturnValue([
      { name: "Shared model", provider: "openai", index: 0 },
      { name: "Shared model", provider: "anthropic", index: 1 },
    ]);
    mocks.currentIndex.mockReturnValue(1);
    const onSelect = vi.fn();
    const { lastFrame, stdin } = render(
      <ModelSelector onSelect={onSelect} onCancel={vi.fn()} />,
    );
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Shared model (openai)");
      expect(lastFrame()).toContain("Shared model (anthropic)");
    });
    await act(async () => {});
    stdin.write("\r");
    await vi.waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "anthropic", index: 1 }),
      ),
    );
  });

  it("navigates duplicate names by their provider index", async () => {
    mocks.available.mockReturnValue([
      { name: "Shared model", provider: "openai", index: 0 },
      { name: "Shared model", provider: "anthropic", index: 1 },
    ]);
    mocks.currentIndex.mockReturnValue(1);
    const onSelect = vi.fn();
    const { lastFrame, stdin } = render(
      <ModelSelector onSelect={onSelect} onCancel={vi.fn()} />,
    );
    await vi.waitFor(() =>
      expect(lastFrame()).toContain("Shared model (anthropic)"),
    );
    await act(async () => {});
    stdin.write("\u001b[A");
    await vi.waitFor(() =>
      expect(lastFrame()).toContain("\u27a4 Shared model (openai)"),
    );
    await act(async () => {});
    stdin.write("\r");
    await vi.waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "openai", index: 0 }),
      ),
    );
  });

  it("cancels without selecting a model", async () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    const { lastFrame, stdin } = render(
      <ModelSelector onSelect={onSelect} onCancel={onCancel} />,
    );
    await vi.waitFor(() => expect(lastFrame()).toContain("Select Model"));
    await act(async () => {});
    stdin.write("\u001b");
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("reports an empty model list without offering a selection", async () => {
    mocks.available.mockReturnValue([]);
    const onSelect = vi.fn();
    const { lastFrame, stdin } = render(
      <ModelSelector onSelect={onSelect} onCancel={vi.fn()} />,
    );
    await vi.waitFor(() =>
      expect(lastFrame()).toContain(
        "No chat models available in the configuration",
      ),
    );
    stdin.write("\r");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
