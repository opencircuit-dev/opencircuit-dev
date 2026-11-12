/**
 * A broadcast queue with per-cursor positions, mirroring the semantics of
 * Rust's `tokio::sync::broadcast`.
 *
 * One publisher, many readers. Each reader holds an independent cursor so
 * multiple consumers attached to the same queue each see every event.
 * Readers created after a value has been published do not replay history —
 * they start at the next value.
 *
 * The buffer is bounded by `bufferLimit` (default 4096). When the buffer
 * fills, the oldest entries are dropped and laggard cursors are
 * fast-forwarded past the gap. Callers who must not drop events should
 * drain promptly or use a larger limit.
 *
 * @internal
 */
export declare class AsyncBroadcastQueue<T> implements AsyncIterable<T> {
  private buffer;
  /** Absolute logical position of `buffer[0]` (entries below have been dropped). */
  private base;
  private cursors;
  private closed;
  private readonly bufferLimit;
  constructor(bufferLimit?: number);
  /** Whether the queue has been closed. New readers see immediate end-of-stream. */
  get isClosed(): boolean;
  /** Whether at least one reader is attached. */
  get hasReaders(): boolean;
  /** Publish a value to every attached reader. */
  publish(value: T): void;
  /**
   * Close the queue. New readers see immediate end-of-stream. Existing
   * readers can still drain values that were published before close;
   * once their cursor reaches the end of the buffer they see end-of-stream.
   */
  close(): void;
  /** Create a new independent reader. */
  reader(): AsyncIterableIterator<T>;
  [Symbol.asyncIterator](): AsyncIterableIterator<T>;
  /** Drop buffer entries that every cursor has already consumed. */
  private trim;
}
//# sourceMappingURL=async-queue.d.ts.map
