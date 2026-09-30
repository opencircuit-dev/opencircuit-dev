import fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { env } from "../env.js";

import {
  assertDailyTokenBudget,
  getDailyBudgetStatus,
  getDailyUsagePath,
  getRecentDailyUsage,
  recordDailyUsage,
  setDailyTokenLimit,
} from "./dailyUsage.js";

const inputUsage = {
  promptTokens: 60,
  completionTokens: 40,
  promptTokensDetails: {
    cachedTokens: 10,
    cacheWriteTokens: 5,
  },
};

describe("daily usage tracking", () => {
  beforeEach(() => {
    fs.rmSync(env.ocircuitHome, { recursive: true, force: true });
    fs.mkdirSync(env.ocircuitHome, { recursive: true, mode: 0o700 });
  });

  afterEach(() => {
    fs.rmSync(env.ocircuitHome, { recursive: true, force: true });
  });

  it("aggregates provider usage without storing prompts or credentials", () => {
    const now = new Date(2026, 8, 30, 12, 0, 0);

    recordDailyUsage({
      provider: "openai-compatible",
      model: "internal-model",
      usage: inputUsage,
      cost: 0.25,
      now,
    });
    recordDailyUsage({
      provider: "openai-compatible",
      model: "internal-model",
      usage: { promptTokens: 5, completionTokens: 7 },
      cost: 0.05,
      now,
    });

    const usage = getDailyBudgetStatus(now);
    expect(usage.totalTokens).toBe(112);
    expect(usage.usage.promptTokens).toBe(65);
    expect(usage.usage.completionTokens).toBe(47);
    expect(usage.usage.cachedTokens).toBe(10);
    expect(usage.usage.totalCost).toBeCloseTo(0.3);
    expect(usage.usage.models).toHaveLength(1);

    const persisted = fs.readFileSync(getDailyUsagePath(), "utf8");
    expect(persisted).not.toContain("What is the user asking?");
    expect(persisted).not.toContain("credentials");
    expect(fs.statSync(getDailyUsagePath()).mode & 0o777).toBe(0o600);
  });

  it("warns and blocks only after the configured daily allowance is reached", () => {
    const now = new Date(2026, 8, 30, 12, 0, 0);
    setDailyTokenLimit("120");

    recordDailyUsage({
      usage: inputUsage,
      cost: 0,
      now,
    });
    expect(getDailyBudgetStatus(now).warning).toBe(true);
    expect(() => assertDailyTokenBudget(now)).not.toThrow();

    recordDailyUsage({
      usage: { promptTokens: 20, completionTokens: 0 },
      cost: 0,
      now,
    });
    const exhausted = getDailyBudgetStatus(now);
    expect(exhausted.exhausted).toBe(true);
    expect(exhausted.remainingTokens).toBe(0);
    expect(() => assertDailyTokenBudget(now)).toThrow(
      "Daily token allowance exhausted",
    );
  });

  it("rolls usage into local calendar days and retains recent history", () => {
    const today = new Date(2026, 8, 30, 12, 0, 0);
    const yesterday = new Date(2026, 8, 29, 12, 0, 0);

    recordDailyUsage({
      usage: { promptTokens: 3, completionTokens: 4 },
      cost: 0,
      now: yesterday,
    });
    recordDailyUsage({
      usage: { promptTokens: 5, completionTokens: 6 },
      cost: 0,
      now: today,
    });

    const recent = getRecentDailyUsage(2, today);
    expect(recent.map((day) => day.date)).toEqual(["2026-09-30", "2026-09-29"]);
    expect(recent[0]?.promptTokens).toBe(5);
    expect(recent[1]?.completionTokens).toBe(4);
  });
});
