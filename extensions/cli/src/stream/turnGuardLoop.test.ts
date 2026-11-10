import { afterEach, describe, expect, it, vi } from "vitest";

import { createLoopGuard } from "./turnGuardLoop.js";

vi.mock("../services/index.js", () => ({ services: {} }));

describe("loop guard limits", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("applies env limits (lower only) and ignores invalid values", () => {
    vi.stubEnv("OC_TURN_MAX_CALLS", "3");
    expect(createLoopGuard(false, true).enforced.limits.maxCalls).toBe(3);
    vi.stubEnv("OC_TURN_MAX_CALLS", "0");
    expect(createLoopGuard(false, true).enforced.limits.maxCalls).toBe(100);
    vi.stubEnv("OC_TURN_MAX_CALLS", "9999");
    expect(createLoopGuard(false, true).enforced.limits.maxCalls).toBe(100);
  });

  it("aborts an in-flight turn at the wall-clock deadline", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(0);
    const abortController = new AbortController();
    const guard = createLoopGuard(false, true, abortController);
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(abortController.signal.aborted).toBe(true);
    expect(guard.enforced.check()).toMatchObject({
      ok: false,
      breach: { reason: "wall_clock" },
    });
    guard.dispose();
    vi.useRealTimers();
  });
});

describe("compaction shares the parent turn guard", () => {
  it("reuses the parent guard inside a turn scope and not outside", async () => {
    const { withTurnScope } = await import("./turnGuardLoop.js");
    await withTurnScope(async () => {
      const parent = createLoopGuard(false, true);
      const child = createLoopGuard(true, true);
      expect(child.enforced).toBe(parent.enforced);
      parent.enforced.reserve([], 1); // no-op invalid batch, still same instance
    });
    const a = createLoopGuard(true, true);
    const b = createLoopGuard(true, true);
    expect(a.enforced).not.toBe(b.enforced);
  });
});
