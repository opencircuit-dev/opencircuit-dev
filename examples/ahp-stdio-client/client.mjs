#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const host = spawn(
  process.execPath,
  [path.join(root, "extensions/cli/dist/oc.js"), "agent", "host"],
  {
    cwd: root,
    stdio: ["pipe", "pipe", "inherit"],
  },
);

let buffer = Buffer.alloc(0);
const responses = [];
const decode = () => {
  while (buffer.length >= 4) {
    const length = buffer.readUInt32BE(0);
    if (buffer.length < length + 4) return;
    responses.push(JSON.parse(buffer.subarray(4, length + 4).toString("utf8")));
    buffer = buffer.subarray(length + 4);
  }
};
host.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  decode();
});

const send = (message) => {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  host.stdin.write(Buffer.concat([header, payload]));
};

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    channel: "ahp-root://",
    clientId: "oc-ahp-stdio-example",
    protocolVersions: ["1.1.0", "1.0.0"],
    initialSubscriptions: ["ahp-root://"],
  },
});
send({
  jsonrpc: "2.0",
  id: 2,
  method: "listSessions",
  params: { channel: "ahp-root://" },
});

setTimeout(() => host.stdin.end(), 250);
host.on("close", (code) => {
  const initialize = responses.find((message) => message.id === 1);
  const list = responses.find((message) => message.id === 2);
  if (
    code !== 0 ||
    initialize?.result?.protocolVersion !== "1.1.0" ||
    !Array.isArray(list?.result?.items)
  ) {
    console.error("AHP stdio example failed", { code, responses });
    process.exitCode = 1;
    return;
  }
  console.log(
    JSON.stringify({
      protocolVersion: initialize.result.protocolVersion,
      sessionCount: list.result.items.length,
    }),
  );
});
