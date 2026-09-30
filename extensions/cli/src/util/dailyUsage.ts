import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Usage } from "core/index.js";

import { env } from "../env.js";

const STATE_VERSION = 1;
const RETENTION_DAYS = 90;
const DEFAULT_WARNING_PERCENT = 80;
const LOCK_STALE_AFTER_MS = 30_000;

export interface DailyUsageTotals {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
}

export interface DailyModelUsage extends DailyUsageTotals {
  provider: string;
  model: string;
}

export interface DailyUsageSnapshot extends DailyUsageTotals {
  date: string;
  models: DailyModelUsage[];
}

export interface UsagePolicy {
  dailyTokenLimit?: number;
  warningPercent: number;
}

export interface DailyBudgetStatus {
  date: string;
  usage: DailyUsageSnapshot;
  dailyTokenLimit?: number;
  warningPercent: number;
  totalTokens: number;
  remainingTokens?: number;
  usedPercent?: number;
  warning: boolean;
  exhausted: boolean;
}

interface PersistedUsageState {
  version: typeof STATE_VERSION;
  days: Record<string, PersistedDay>;
}

interface PersistedDay extends DailyUsageTotals {
  models: DailyModelUsage[];
}

interface SettingsFile {
  usage?: {
    dailyTokenLimit?: unknown;
    warningPercent?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const emptyTotals = (): DailyUsageTotals => ({
  promptTokens: 0,
  completionTokens: 0,
  cachedTokens: 0,
  cacheWriteTokens: 0,
  totalCost: 0,
});

function emptyState(): PersistedUsageState {
  return { version: STATE_VERSION, days: {} };
}

function emptyDay(): PersistedDay {
  return { ...emptyTotals(), models: [] };
}

function getDateKey(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getStorageDirectory(): string {
  return env.ocircuitHome || path.join(os.homedir(), ".ocircuit");
}

export function getDailyUsagePath(): string {
  return path.join(getStorageDirectory(), "usage.json");
}

export function getSettingsPath(): string {
  return path.join(getStorageDirectory(), "settings.json");
}

function ensureStorageDirectory(): void {
  const directory = getStorageDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function assertNotSymlink(filePath: string): void {
  if (fs.existsSync(filePath) && fs.lstatSync(filePath).isSymbolicLink()) {
    throw new Error(`Refusing to use symlinked usage file: ${filePath}`);
  }
}

function parseNonNegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative safe integer`);
  }
  return value;
}

function parseNonNegativeNumber(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative finite number`);
  }
  return value;
}

function parseTotals(value: unknown, prefix: string): DailyUsageTotals {
  if (!value || typeof value !== "object") {
    throw new Error(`${prefix} must be an object`);
  }
  const totals = value as Record<string, unknown>;
  return {
    promptTokens: parseNonNegativeInteger(
      totals.promptTokens,
      `${prefix}.promptTokens`,
    ),
    completionTokens: parseNonNegativeInteger(
      totals.completionTokens,
      `${prefix}.completionTokens`,
    ),
    cachedTokens: parseNonNegativeInteger(
      totals.cachedTokens,
      `${prefix}.cachedTokens`,
    ),
    cacheWriteTokens: parseNonNegativeInteger(
      totals.cacheWriteTokens,
      `${prefix}.cacheWriteTokens`,
    ),
    totalCost: parseNonNegativeNumber(totals.totalCost, `${prefix}.totalCost`),
  };
}

function normalizeLabel(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 200);
}

function parseState(value: unknown): PersistedUsageState {
  if (!value || typeof value !== "object") {
    throw new Error("Usage state must be an object");
  }

  const state = value as Record<string, unknown>;
  if (
    state.version !== STATE_VERSION ||
    !state.days ||
    typeof state.days !== "object"
  ) {
    throw new Error("Unsupported usage state format");
  }

  const days: Record<string, PersistedDay> = {};
  for (const [date, rawDay] of Object.entries(
    state.days as Record<string, unknown>,
  )) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Invalid usage date: ${date}`);
    }
    if (!rawDay || typeof rawDay !== "object") {
      throw new Error(`Invalid usage data for ${date}`);
    }

    const day = rawDay as Record<string, unknown>;
    const rawModels = day.models;
    if (!Array.isArray(rawModels)) {
      throw new Error(`Invalid model usage data for ${date}`);
    }

    days[date] = {
      ...parseTotals(day, `days.${date}`),
      models: rawModels.map((rawModel, index) => {
        if (!rawModel || typeof rawModel !== "object") {
          throw new Error(`Invalid model usage at ${date}[${index}]`);
        }
        const model = rawModel as Record<string, unknown>;
        return {
          ...parseTotals(model, `days.${date}.models[${index}]`),
          provider: normalizeLabel(model.provider, "unknown"),
          model: normalizeLabel(model.model, "unknown"),
        };
      }),
    };
  }

  return { version: STATE_VERSION, days };
}

function readUsageState(): PersistedUsageState {
  const usagePath = getDailyUsagePath();
  if (!fs.existsSync(usagePath)) {
    return emptyState();
  }
  assertNotSymlink(usagePath);
  return parseState(JSON.parse(fs.readFileSync(usagePath, "utf8")));
}

function readSettings(): SettingsFile {
  const settingsPath = getSettingsPath();
  if (!fs.existsSync(settingsPath)) {
    return {};
  }
  assertNotSymlink(settingsPath);
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("~/.ocircuit/settings.json must contain a JSON object");
  }
  return settings as SettingsFile;
}

function writeJsonAtomically(filePath: string, value: unknown): void {
  assertNotSymlink(filePath);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  const fileDescriptor = fs.openSync(temporaryPath, "wx", 0o600);
  try {
    fs.writeFileSync(
      fileDescriptor,
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8",
    );
    fs.fchmodSync(fileDescriptor, 0o600);
  } finally {
    fs.closeSync(fileDescriptor);
  }
  fs.renameSync(temporaryPath, filePath);
  fs.chmodSync(filePath, 0o600);
}

function withStorageLock<T>(callback: () => T): T {
  ensureStorageDirectory();
  const lockPath = `${getDailyUsagePath()}.lock`;
  let fileDescriptor: number | undefined;

  try {
    try {
      fileDescriptor = fs.openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }

      const lockAge = Date.now() - fs.statSync(lockPath).mtimeMs;
      if (lockAge <= LOCK_STALE_AFTER_MS) {
        throw new Error("Daily usage store is busy; try again shortly");
      }
      fs.unlinkSync(lockPath);
      fileDescriptor = fs.openSync(lockPath, "wx", 0o600);
    }

    return callback();
  } finally {
    if (fileDescriptor !== undefined) {
      fs.closeSync(fileDescriptor);
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // The lock may have been removed while recovering a stale lock.
      }
    }
  }
}

function pruneOldDays(state: PersistedUsageState, now: Date): void {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffKey = getDateKey(cutoff);
  for (const date of Object.keys(state.days)) {
    if (date < cutoffKey) {
      delete state.days[date];
    }
  }
}

function snapshotForDate(
  state: PersistedUsageState,
  date: string,
): DailyUsageSnapshot {
  const day = state.days[date] ?? emptyDay();
  return {
    date,
    ...parseTotals(day, `days.${date}`),
    models: day.models.map((model) => ({ ...model })),
  };
}

function parseLimit(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string" && !/^\d+$/.test(value)) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }
  return parseNonNegativeInteger(
    typeof value === "string" ? Number(value) : value,
    fieldName,
  );
}

function parseWarningPercent(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_WARNING_PERCENT;
  }
  const percent = typeof value === "string" ? Number(value) : value;
  if (
    typeof percent !== "number" ||
    !Number.isFinite(percent) ||
    percent <= 0 ||
    percent > 100
  ) {
    throw new Error("warningPercent must be greater than 0 and at most 100");
  }
  return percent;
}

export function loadUsagePolicy(): UsagePolicy {
  const settings = readSettings();
  const configuredUsage = settings.usage ?? {};
  const dailyTokenLimit = parseLimit(
    process.env.OCIRCUIT_DAILY_TOKEN_LIMIT ?? configuredUsage.dailyTokenLimit,
    "dailyTokenLimit",
  );
  const warningPercent = parseWarningPercent(
    process.env.OCIRCUIT_DAILY_TOKEN_WARNING_PERCENT ??
      configuredUsage.warningPercent,
  );
  return { dailyTokenLimit, warningPercent };
}

export function setDailyTokenLimit(limit: number | string | undefined): void {
  const parsedLimit = parseLimit(limit, "dailyTokenLimit");
  withStorageLock(() => {
    const settings = readSettings();
    const usage = { ...(settings.usage ?? {}) };
    if (parsedLimit === undefined) {
      delete usage.dailyTokenLimit;
    } else {
      usage.dailyTokenLimit = parsedLimit;
    }
    if (Object.keys(usage).length === 0) {
      delete settings.usage;
    } else {
      settings.usage = usage;
    }
    writeJsonAtomically(getSettingsPath(), settings);
  });
}

export function getDailyUsage(now: Date = new Date()): DailyUsageSnapshot {
  return snapshotForDate(readUsageState(), getDateKey(now));
}

export function getRecentDailyUsage(
  days: number = 7,
  now: Date = new Date(),
): DailyUsageSnapshot[] {
  if (!Number.isSafeInteger(days) || days < 1 || days > RETENTION_DAYS) {
    throw new Error(`days must be an integer between 1 and ${RETENTION_DAYS}`);
  }

  const state = readUsageState();
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now);
    date.setDate(date.getDate() - index);
    return snapshotForDate(state, getDateKey(date));
  });
}

export function getDailyBudgetStatus(
  now: Date = new Date(),
): DailyBudgetStatus {
  const policy = loadUsagePolicy();
  const usage = getDailyUsage(now);
  const totalTokens = usage.promptTokens + usage.completionTokens;
  const dailyTokenLimit = policy.dailyTokenLimit;
  const usedPercent =
    dailyTokenLimit === undefined || dailyTokenLimit === 0
      ? dailyTokenLimit === 0
        ? 100
        : undefined
      : (totalTokens / dailyTokenLimit) * 100;

  return {
    date: usage.date,
    usage,
    dailyTokenLimit,
    warningPercent: policy.warningPercent,
    totalTokens,
    remainingTokens:
      dailyTokenLimit === undefined
        ? undefined
        : Math.max(0, dailyTokenLimit - totalTokens),
    usedPercent,
    warning:
      dailyTokenLimit !== undefined &&
      (dailyTokenLimit === 0 || (usedPercent ?? 0) >= policy.warningPercent),
    exhausted: dailyTokenLimit !== undefined && totalTokens >= dailyTokenLimit,
  };
}

export class DailyTokenBudgetExceededError extends Error {
  constructor(public readonly status: DailyBudgetStatus) {
    super(
      `Daily token allowance exhausted (${status.totalTokens.toLocaleString()} / ${status.dailyTokenLimit?.toLocaleString()} tokens). Use 'oc usage' to review the allowance or update ~/.ocircuit/settings.json.`,
    );
    this.name = "DailyTokenBudgetExceededError";
  }
}

export function assertDailyTokenBudget(
  now: Date = new Date(),
): DailyBudgetStatus {
  const status = getDailyBudgetStatus(now);
  if (status.exhausted) {
    throw new DailyTokenBudgetExceededError(status);
  }
  return status;
}

export interface RecordDailyUsageOptions {
  provider?: string;
  model?: string;
  usage: Usage;
  cost: number;
  now?: Date;
}

export function recordDailyUsage({
  provider,
  model,
  usage,
  cost,
  now = new Date(),
}: RecordDailyUsageOptions): DailyBudgetStatus {
  const date = getDateKey(now);
  const increment: DailyUsageTotals = {
    promptTokens: parseNonNegativeInteger(usage.promptTokens, "promptTokens"),
    completionTokens: parseNonNegativeInteger(
      usage.completionTokens,
      "completionTokens",
    ),
    cachedTokens: parseNonNegativeInteger(
      usage.promptTokensDetails?.cachedTokens ?? 0,
      "cachedTokens",
    ),
    cacheWriteTokens: parseNonNegativeInteger(
      usage.promptTokensDetails?.cacheWriteTokens ?? 0,
      "cacheWriteTokens",
    ),
    totalCost: parseNonNegativeNumber(cost, "cost"),
  };
  const modelUsage: DailyModelUsage = {
    ...increment,
    provider: normalizeLabel(provider, "unknown"),
    model: normalizeLabel(model, "unknown"),
  };

  withStorageLock(() => {
    const state = readUsageState();
    pruneOldDays(state, now);
    const day = (state.days[date] ??= emptyDay());
    for (const key of Object.keys(increment) as Array<keyof DailyUsageTotals>) {
      day[key] += increment[key];
    }

    const existingModel = day.models.find(
      (entry) =>
        entry.provider === modelUsage.provider &&
        entry.model === modelUsage.model,
    );
    if (existingModel) {
      for (const key of Object.keys(increment) as Array<
        keyof DailyUsageTotals
      >) {
        existingModel[key] += increment[key];
      }
    } else {
      day.models.push(modelUsage);
    }

    writeJsonAtomically(getDailyUsagePath(), state);
  });

  return getDailyBudgetStatus(now);
}
