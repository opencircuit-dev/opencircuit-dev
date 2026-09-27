function getHeaderValue(headers: unknown, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }

  if (typeof (headers as { get?: unknown }).get === "function") {
    return (
      (headers as { get(name: string): string | null }).get(name) ?? undefined
    );
  }

  if (typeof headers === "object") {
    const entry = Object.entries(headers).find(
      ([key]) => key.toLowerCase() === name.toLowerCase(),
    );
    return entry?.[1] === null || entry?.[1] === undefined
      ? undefined
      : String(entry[1]);
  }

  return undefined;
}

function parseRetryAfter(value: string): number | undefined {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export function getRetryAfterDelay(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const rateLimitError = error as {
    headers?: unknown;
    response?: { headers?: unknown };
    message?: string;
  };
  const headers = rateLimitError.headers ?? rateLimitError.response?.headers;
  const retryAfterMs = getHeaderValue(headers, "retry-after-ms");

  if (retryAfterMs !== undefined) {
    const delay = Number(retryAfterMs);
    if (Number.isFinite(delay) && delay >= 0) {
      return delay;
    }
  }

  const retryAfter = getHeaderValue(headers, "retry-after");
  const headerDelay =
    retryAfter === undefined ? undefined : parseRetryAfter(retryAfter);
  if (headerDelay !== undefined) {
    return headerDelay;
  }

  const messageDelay = rateLimitError.message?.match(
    /retry\s+after\s+(\d+(?:\.\d+)?)\s*(milliseconds?|msecs?|ms|seconds?|secs?|s)\b/i,
  );
  if (!messageDelay) {
    return undefined;
  }

  const amount = Number(messageDelay[1]);
  const unit = messageDelay[2].toLowerCase();
  const delay = unit.startsWith("m") ? amount : amount * 1000;
  return Number.isFinite(delay) ? delay : undefined;
}
