const HEADER_BYTES = 4;
export const DEFAULT_MAX_FRAME_BYTES = 4 * 1024 * 1024;

export class StdioFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StdioFrameError";
  }
}

export function encodeStdioFrame(
  message: unknown,
  maxFrameBytes = DEFAULT_MAX_FRAME_BYTES,
): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.length === 0 || payload.length > maxFrameBytes) {
    throw new StdioFrameError("AHP frame is empty or exceeds the size limit");
  }
  const header = Buffer.allocUnsafe(HEADER_BYTES);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export class StdioFrameDecoder {
  private buffer = Buffer.alloc(0);

  constructor(private readonly maxFrameBytes = DEFAULT_MAX_FRAME_BYTES) {}

  push(chunk: Uint8Array): unknown[] {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    if (this.buffer.length > this.maxFrameBytes + HEADER_BYTES) {
      throw new StdioFrameError("AHP frame buffer exceeds the size limit");
    }
    const messages: unknown[] = [];
    while (this.buffer.length >= HEADER_BYTES) {
      const length = this.buffer.readUInt32BE(0);
      if (length === 0 || length > this.maxFrameBytes) {
        throw new StdioFrameError("AHP frame length is invalid or too large");
      }
      if (this.buffer.length < HEADER_BYTES + length) return messages;
      const payload = this.buffer.subarray(HEADER_BYTES, HEADER_BYTES + length);
      this.buffer = this.buffer.subarray(HEADER_BYTES + length);
      try {
        messages.push(JSON.parse(payload.toString("utf8")) as unknown);
      } catch {
        throw new StdioFrameError("AHP frame does not contain valid JSON");
      }
    }
    return messages;
  }

  finish(): void {
    if (this.buffer.length !== 0) {
      throw new StdioFrameError("AHP stdio ended with a partial frame");
    }
  }
}
