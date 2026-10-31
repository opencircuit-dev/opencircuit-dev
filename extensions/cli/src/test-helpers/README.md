# CLI test helpers

This directory contains fixtures and helpers for running CLI tests without
calling an external model provider. `mock-llm-server.ts` starts an
OpenAI-compatible HTTP fixture bound to loopback on an ephemeral port.

## Mock server example

```typescript
import { expect } from "vitest";
import {
  cleanupTestContext,
  createTestContext,
  runCLI,
} from "./cli-helpers.js";
import { cleanupMockLLMServer, setupMockLLMTest } from "./mock-llm-server.js";

const context = await createTestContext();
const mockServer = await setupMockLLMTest(context, {
  response: (prompt) =>
    prompt.includes("weather") ? "It's sunny!" : "Mock response",
});

try {
  const result = await runCLI(context, {
    args: ["-p", "Test prompt", "--config", context.configPath!],
  });
  expect(result.stdout).toContain("Mock response");
  expect(mockServer.requests).toHaveLength(1);
} finally {
  await cleanupMockLLMServer(mockServer);
  await cleanupTestContext(context);
}
```

`setupMockLLMTest()` writes a temporary config and onboarding marker into the
provided CLI test context. `createMockLLMServer()` can be used when a test
needs to manage its own configuration; `createMockLLMConfig()` generates the
matching YAML. The fixture emits SSE in both modes: `streaming: false` sends
the full response as one event rather than splitting it into word-sized
events. `customHandler` is available for endpoint-specific cases.

Run the relevant test from `extensions/cli` with the package's Vitest runner,
for example:

```bash
npm test -- src/e2e/headless-mock-llm.test.ts
```
