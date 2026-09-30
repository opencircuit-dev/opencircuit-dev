process.env.IS_BINARY = "true";

const body = new TextEncoder().encode(
  JSON.stringify({
    protocolVersion: 1,
    kind: "hello",
    requestId: require("node:crypto").randomUUID(),
  }),
);
const frame = new Uint8Array(4 + body.length);
new DataView(frame.buffer).setUint32(0, body.length, false);
frame.set(body, 4);

process.stdout.write(frame, (error) => {
  if (error) {
    process.exitCode = 1;
    return;
  }
  void import("./NativeWorkbenchBackend")
    .then(({ runNativeWorkbenchBackend }) => runNativeWorkbenchBackend(true))
    .catch((error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : "Backend startup failed"}\n`,
      );
      process.exitCode = 1;
    });
});
