export interface ProviderRequestThrottleOptions {
  /** Minimum spacing between completed requests for one provider/model key. */
  minIntervalMs?: number;
  /** Positive jitter added to provider cooldowns, expressed as a ratio. */
  jitterRatio?: number;
  now?: () => number;
  random?: () => number;
}

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  started: boolean;
  settled: boolean;
  onAbort?: () => void;
}

interface Bucket {
  active: boolean;
  nextAvailableAt: number;
  cooldownUntil: number;
  queue: Waiter[];
}

const DEFAULT_OPTIONS: Required<
  Pick<ProviderRequestThrottleOptions, "minIntervalMs" | "jitterRatio">
> = {
  minIntervalMs: 1000,
  jitterRatio: 0.1,
};

function requestAbortedError(): Error {
  return new Error("Request aborted");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(requestAbortedError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
    }
  });
}

/**
 * Serializes requests and applies a shared provider cooldown per key.
 * A key should identify the effective provider and model, for example
 * `openai-compatible/gemini-3.1-flash-lite`.
 */
export class ProviderRequestThrottle {
  private readonly buckets = new Map<string, Bucket>();
  private readonly minIntervalMs: number;
  private readonly jitterRatio: number;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(options: ProviderRequestThrottleOptions = {}) {
    this.minIntervalMs = Math.max(
      0,
      options.minIntervalMs ?? DEFAULT_OPTIONS.minIntervalMs,
    );
    this.jitterRatio = Math.max(
      0,
      options.jitterRatio ?? DEFAULT_OPTIONS.jitterRatio,
    );
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  async acquire(key: string, signal?: AbortSignal): Promise<() => void> {
    if (!key.trim()) {
      throw new Error("Provider request throttle key must not be empty");
    }
    if (signal?.aborted) {
      throw requestAbortedError();
    }

    const bucket = this.getBucket(key);
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        signal,
        started: false,
        settled: false,
      };

      const onAbort = () => {
        if (waiter.started || waiter.settled) {
          return;
        }
        waiter.settled = true;
        const index = bucket.queue.indexOf(waiter);
        if (index >= 0) {
          bucket.queue.splice(index, 1);
        }
        reject(requestAbortedError());
        this.drain(key, bucket);
      };

      waiter.onAbort = onAbort;
      signal?.addEventListener("abort", onAbort, { once: true });
      bucket.queue.push(waiter);
      this.drain(key, bucket);
    });
  }

  /**
   * Extends the shared cooldown after a provider rate-limit response.
   * Jitter is positive-only so the client never retries before provider
   * guidance expires.
   */
  recordRateLimit(key: string, delayMs: number): void {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      return;
    }

    const bucket = this.getBucket(key);
    const jitterMs = Math.floor(delayMs * this.jitterRatio * this.random());
    bucket.cooldownUntil = Math.max(
      bucket.cooldownUntil,
      this.now() + delayMs + jitterMs,
    );
  }

  private getBucket(key: string): Bucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        active: false,
        nextAvailableAt: 0,
        cooldownUntil: 0,
        queue: [],
      };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private drain(key: string, bucket: Bucket): void {
    if (bucket.active) {
      return;
    }

    const waiter = bucket.queue.shift();
    if (!waiter) {
      return;
    }

    bucket.active = true;
    waiter.started = true;
    void this.startWaiter(key, bucket, waiter);
  }

  private async startWaiter(
    key: string,
    bucket: Bucket,
    waiter: Waiter,
  ): Promise<void> {
    try {
      const now = this.now();
      const delay =
        Math.max(bucket.nextAvailableAt, bucket.cooldownUntil, now) - now;
      await sleep(delay, waiter.signal);

      if (waiter.signal?.aborted) {
        throw requestAbortedError();
      }

      let released = false;
      const release = () => {
        if (released) {
          return;
        }
        released = true;
        bucket.nextAvailableAt = this.now() + this.minIntervalMs;
        bucket.active = false;
        this.drain(key, bucket);
      };

      waiter.settled = true;
      waiter.signal?.removeEventListener("abort", waiter.onAbort!);
      waiter.resolve(release);
    } catch (error) {
      waiter.settled = true;
      waiter.signal?.removeEventListener("abort", waiter.onAbort!);
      waiter.reject(error instanceof Error ? error : new Error(String(error)));
      bucket.active = false;
      this.drain(key, bucket);
    }
  }
}

export const providerRequestThrottle = new ProviderRequestThrottle();
