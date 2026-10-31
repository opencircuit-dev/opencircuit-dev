import { render } from "ink-testing-library";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { services } from "../services/index.js";

import { ModelSelector } from "./ModelSelector.js";

vi.mock("../services/index.js", () => ({
  services: {
    model: {
      getAvailableChatModels: vi.fn(),
      getCurrentModelIndex: vi.fn(),
    },
  },
}));

describe("ModelSelector", () => {
  const onSelect = vi.fn();
  const onCancel = vi.fn();
  const apps: ReturnType<typeof render>[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(services.model.getAvailableChatModels).mockReturnValue([
      { name: "Shared model", provider: "openai", index: 0 },
      { name: "Shared model", provider: "anthropic", index: 1 },
    ]);
    vi.mocked(services.model.getCurrentModelIndex).mockReturnValue(1);
  });

  afterEach(() => {
    for (const app of apps.splice(0)) {
      app.unmount();
      app.cleanup();
    }
  });

  function renderPicker() {
    const app = render(
      <ModelSelector onSelect={onSelect} onCancel={onCancel} />,
    );
    apps.push(app);
    return app;
  }

  it("qualifies duplicate names by provider and selects the current model", async () => {
    const app = renderPicker();
    await vi.waitFor(() => {
      expect(app.lastFrame()).toContain("Shared model (openai)");
      expect(app.lastFrame()).toContain("Shared model (anthropic)");
    });

    app.stdin.write("\r");

    await vi.waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "anthropic", index: 1 }),
      );
    });
  });

  it("navigates to the other provider and switches by its index", async () => {
    const app = renderPicker();
    await vi.waitFor(() =>
      expect(app.lastFrame()).toContain("Shared model (anthropic)"),
    );

    app.stdin.write("\u001b[A");
    await vi.waitFor(() =>
      expect(app.lastFrame()).toContain("➤ Shared model (openai)"),
    );
    app.stdin.write("\r");

    await vi.waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "openai", index: 0 }),
      );
    });
  });

  it("cancels without selecting a model", async () => {
    const app = renderPicker();
    await vi.waitFor(() => expect(app.lastFrame()).toContain("Select Model"));

    app.stdin.write("\u001b");

    await vi.waitFor(() => expect(onCancel).toHaveBeenCalledOnce());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("reports an empty model list without offering a selection", async () => {
    vi.mocked(services.model.getAvailableChatModels).mockReturnValue([]);
    const app = renderPicker();

    await vi.waitFor(() =>
      expect(app.lastFrame()).toContain(
        "No chat models available in the configuration",
      ),
    );
    app.stdin.write("\r");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
