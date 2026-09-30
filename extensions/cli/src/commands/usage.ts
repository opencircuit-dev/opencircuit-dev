import chalk from "chalk";

import {
  getDailyBudgetStatus,
  getRecentDailyUsage,
  loadUsagePolicy,
  setDailyTokenLimit,
} from "../util/dailyUsage.js";

interface UsageCommandOptions {
  json?: boolean;
  days?: string;
  setDailyLimit?: string;
  clearDailyLimit?: boolean;
}

function parseDays(value: string | undefined): number {
  const days = Number(value ?? "7");
  if (!Number.isSafeInteger(days) || days < 1 || days > 90) {
    throw new Error("--days must be an integer between 1 and 90");
  }
  return days;
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

function printHumanReadable(options: UsageCommandOptions): void {
  const days = parseDays(options.days);
  const status = getDailyBudgetStatus();
  const recent = getRecentDailyUsage(days);
  const limit = status.dailyTokenLimit;

  console.log(chalk.bold(`Daily token usage (${status.date})`));
  console.log(`  Input tokens:  ${formatNumber(status.usage.promptTokens)}`);
  console.log(
    `  Output tokens: ${formatNumber(status.usage.completionTokens)}`,
  );
  console.log(`  Total tokens:  ${formatNumber(status.totalTokens)}`);
  console.log(
    limit === undefined
      ? "  Allowance:     not configured"
      : `  Allowance:     ${formatNumber(status.totalTokens)} / ${formatNumber(limit)}`,
  );
  if (status.remainingTokens !== undefined) {
    console.log(`  Remaining:     ${formatNumber(status.remainingTokens)}`);
  }
  if (status.usedPercent !== undefined && limit !== undefined) {
    console.log(`  Used:          ${status.usedPercent.toFixed(1)}%`);
  }
  console.log(`  Known cost:    $${status.usage.totalCost.toFixed(6)}`);

  if (status.exhausted) {
    console.log(
      chalk.red("  Status:        exhausted; new requests are blocked"),
    );
  } else if (status.warning) {
    console.log(chalk.yellow("  Status:        warning threshold reached"));
  }

  console.log(chalk.bold(`\nLast ${days} days`));
  for (const day of recent) {
    console.log(
      `  ${day.date}: ${formatNumber(day.promptTokens + day.completionTokens)} tokens, $${day.totalCost.toFixed(6)}`,
    );
  }

  const policy = loadUsagePolicy();
  console.log(
    chalk.dim(
      `\nWarning threshold: ${policy.warningPercent}%. Usage is stored locally in ~/.ocircuit/usage.json.`,
    ),
  );
}

export async function usageCommand(
  options: UsageCommandOptions = {},
): Promise<void> {
  if (options.setDailyLimit !== undefined && options.clearDailyLimit) {
    throw new Error("Choose either --set-daily-limit or --clear-daily-limit");
  }

  if (options.setDailyLimit !== undefined) {
    setDailyTokenLimit(options.setDailyLimit);
    console.log(`Daily token allowance set to ${options.setDailyLimit}.`);
  } else if (options.clearDailyLimit) {
    setDailyTokenLimit(undefined);
    console.log("Daily token allowance cleared.");
  }

  const days = parseDays(options.days);
  const status = getDailyBudgetStatus();
  const recent = getRecentDailyUsage(days);

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          date: status.date,
          usage: status.usage,
          dailyTokenLimit: status.dailyTokenLimit,
          warningPercent: status.warningPercent,
          totalTokens: status.totalTokens,
          remainingTokens: status.remainingTokens,
          usedPercent: status.usedPercent,
          warning: status.warning,
          exhausted: status.exhausted,
          recent,
        },
        null,
        2,
      ),
    );
    return;
  }

  printHumanReadable(options);
}
