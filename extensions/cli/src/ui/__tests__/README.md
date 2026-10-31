# CLI TUI tests

This directory contains Vitest tests for the CLI terminal UI. The
`TUIChat.dualModeHelper.tsx` helper provides `testBothModes`,
`testSingleMode`, and `renderInMode` for local and remote UI paths.
`createUITestContext()` supplies the test service context.

The remote fixture is in `mockRemoteServer.ts`; it simulates the remote chat
endpoints used by UI tests. Tests should use the existing helper and fixtures
rather than assuming a live `oc serve` instance is available.

## Example

```tsx
import { expect } from "vitest";
import { renderInMode, testBothModes } from "./TUIChat.dualModeHelper.js";

testBothModes("renders the chat", async (mode) => {
  const app = renderInMode(mode);
  expect(app.lastFrame()).toContain("Expected content");
});
```

Use the local/remote argument only when the assertion genuinely depends on
the mode. Keep test setup isolated and clean up any server or UI resources
created directly by a test.

Run a focused test from `extensions/cli`:

```bash
npm test -- src/ui/__tests__/TUIChat.basic.test.tsx
```
