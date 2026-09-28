import { describe, expect, it, vi } from "vitest";

import { ProviderRequestThrottle } from "./providerRequestThrottle.js";

describe("ProviderRequestThrottle", () => {
  it("serializes requests for the same provider/model key", async () => {
    vi.useFakeTimers();
    try {
      const throttle = new ProviderRequestThrottle({ minIntervalMs: 10 });
      const firstRelease = await throttle.acquire("openai/gpt-4o-mini");
      let secondRelease: (() => void) | undefined;
      const secondAcquire = throttle
        .acquire("openai/gpt-4o-mini")
        .then((release) => {
          secondRelease = release;
        });

      await vi.advanceTimersByTimeAsync(0);
      expect(secondRelease).toBeUndefined();

      firstRelease();
      await vi.advanceTimersByTimeAsync(9);
      expect(secondRelease).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await secondAcquire;
      expect(secondRelease).toBeTypeOf("function");
      secondRelease!();
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows different provider/model keys to proceed independently", async () => {
    const throttle = new ProviderRequestThrottle({ minIntervalMs: 1000 });
    const openaiRelease = await throttle.acquire("openai/gpt-4o-mini");
    const anthropicRelease = await throttle.acquire("anthropic/claude");

    expect(openaiRelease).toBeTypeOf("function");
    expect(anthropicRelease).toBeTypeOf("function");
    openaiRelease();
    anthropicRelease();
  });

  it("blocks queued requests for the provider cooldown plus positive jitter", async () => {
    vi.useFakeTimers();
    try {
      const throttle = new ProviderRequestThrottle({
        minIntervalMs: 0,
        jitterRatio: 0.1,
        random: () => 1,
      });
      const firstRelease = await throttle.acquire("openai/gpt-4o-mini");
      throttle.recordRateLimit("openai/gpt-4o-mini", 100);

      let secondRelease: (() => void) | undefined;
      const secondAcquire = throttle
        .acquire("openai/gpt-4o-mini")
        .then((release) => {
          secondRelease = release;
        });

      firstRelease();
      await vi.advanceTimersByTimeAsync(109);
      expect(secondRelease).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await secondAcquire;
      expect(secondRelease).toBeTypeOf("function");
      secondRelease!();
    } finally {
      vi.useRealTimers();
    }
  });
});
