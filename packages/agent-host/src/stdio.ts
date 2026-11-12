import { AgentHost } from "./host.js";
import { encodeStdioFrame, StdioFrameDecoder } from "./framing.js";

export interface StdioHostStreams {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  error?: NodeJS.WritableStream;
}

export async function runStdioHost(
  host: AgentHost,
  streams: StdioHostStreams = {
    input: process.stdin,
    output: process.stdout,
    error: process.stderr,
  },
): Promise<void> {
  const decoder = new StdioFrameDecoder();
  let chain = Promise.resolve();
  streams.input.on("data", (chunk: Buffer) => {
    chain = chain.then(async () => {
      for (const message of decoder.push(chunk)) {
        const response = await host.handle(message);
        const outputs = Array.isArray(response) ? response : [response];
        for (const output of outputs) {
          if (output !== null) streams.output.write(encodeStdioFrame(output));
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    streams.input.once("end", () => {
      chain.then(() => {
        decoder.finish();
        resolve();
      }, reject);
    });
    streams.input.once("error", reject);
  });
}
