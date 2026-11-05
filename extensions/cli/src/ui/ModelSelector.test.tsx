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
      expect(lastFrame()).toContain("Configured GPT (configured)");
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
      expect(lastFrame()).toContain("Discovered 1 (discovered)");
      expect(lastFrame()).not.toContain("Discovered 24");
      expect(lastFrame()).not.toContain("discovering...");
    });
    await act(async () => {});
    stdin.write("\u001b[A");
    await vi.waitFor(() =>
      expect(lastFrame()).toContain("Discovered 24 (discovered)"),
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
});
