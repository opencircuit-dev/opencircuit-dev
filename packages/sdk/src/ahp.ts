import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import {
  AhpClient,
  type AhpTransport,
  type JsonRpcMessage,
  type TransportFrame,
} from "@opencircuit/ahp-protocol-sdk/client";
import type { ProtocolMessage } from "@opencircuit/ahp-protocol-sdk";

const MAX_FRAME_BYTES = 4 * 1024 * 1024;

function encodeStdioFrame(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.length === 0 || payload.length > MAX_FRAME_BYTES) {
    throw new Error("AHP frame is empty or exceeds the size limit");
  }
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

class StdioFrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Uint8Array): unknown[] {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    if (this.buffer.length > MAX_FRAME_BYTES + 4) {
      throw new Error("AHP frame exceeds the size limit");
    }
    const messages: unknown[] = [];
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0);
      if (length === 0 || length > MAX_FRAME_BYTES) {
        throw new Error("Invalid AHP frame length");
      }
      if (this.buffer.length < length + 4) return messages;
      messages.push(
        JSON.parse(
          this.buffer.subarray(4, length + 4).toString("utf8"),
        ) as unknown,
      );
      this.buffer = this.buffer.subarray(length + 4);
    }
    return messages;
  }
}

export interface StdioAhpClientOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  requestTimeoutMs?: number;
}

class StdioTransport implements AhpTransport {
  private readonly decoder = new StdioFrameDecoder();
  private readonly pending: Array<(frame: TransportFrame | null) => void> = [];
  private readonly frames: TransportFrame[] = [];
  private closed = false;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.on("data", (chunk: Buffer) => {
      for (const message of this.decoder.push(chunk)) {
        this.deliver({ kind: "parsed", message: message as ProtocolMessage });
      }
    });
    child.stdout.on("end", () => this.finish());
    child.stdout.on("error", () => this.finish());
  }

  send(message: JsonRpcMessage | string): void {
    if (this.closed) throw new Error("AHP stdio transport is closed");
    const parsed = typeof message === "string" ? JSON.parse(message) : message;
    this.child.stdin.write(encodeStdioFrame(parsed));
  }

  recv(): Promise<TransportFrame | null> {
    if (this.frames.length > 0)
      return Promise.resolve(this.frames.shift() ?? null);
    if (this.closed) return Promise.resolve(null);
    return new Promise((resolve) => this.pending.push(resolve));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.finish();
    this.child.stdin.end();
    this.child.kill();
  }

  private deliver(frame: TransportFrame): void {
    const waiter = this.pending.shift();
    if (waiter) waiter(frame);
    else this.frames.push(frame);
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    for (const waiter of this.pending.splice(0)) waiter(null);
  }
}

export interface StdioAhpConnection {
  client: AhpClient;
  process: ChildProcessWithoutNullStreams;
  close(): Promise<void>;
}

/** Spawn an OC AHP host and return the official client over OC's stdio framing. */
export function spawnStdioAhpClient(
  options: StdioAhpClientOptions,
): StdioAhpConnection {
  const child = spawn(options.command, options.args ?? [], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const transport = new StdioTransport(child);
  const client = new AhpClient(transport, {
    requestTimeoutMs: options.requestTimeoutMs,
  });
  client.connect();
  return {
    client,
    process: child,
    close: () => client.shutdown(),
  };
}
