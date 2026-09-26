import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  createSmokeContext,
  cleanupSmokeContext,
  writeOCircuitProxyConfig,
  runHeadless,
  type SmokeTestContext,
} from "./smoke-api-helpers.js";

const OCIRCUIT_API_KEY = process.env.OCIRCUIT_API_KEY;
// ocircuit-proxy requires a 4-part model name (owner/package/provider/model)
// that depends on org-specific proxy configuration, so we also require
// SMOKE_PROXY_MODEL to be set (e.g. "opencircuit-dev/default/anthropic/claude-3-haiku-20240307")
const SMOKE_PROXY_MODEL = process.env.SMOKE_PROXY_MODEL;

describe.skipIf(!OCIRCUIT_API_KEY || !SMOKE_PROXY_MODEL)(
  "Smoke: Headless → Open Circuit API proxy",
  () => {
    let ctx: SmokeTestContext;

    beforeEach(async () => {
      ctx = await createSmokeContext();
      await writeOCircuitProxyConfig(ctx, OCIRCUIT_API_KEY!);
    });

    afterEach(async () => {
      await cleanupSmokeContext(ctx);
    });

    it("should complete a round-trip and return a response", async () => {
      const result = await runHeadless(ctx, [
        "-p",
        "--config",
        ctx.configPath,
        "Reply with exactly the word 'hello' and nothing else.",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.toLowerCase()).toContain("hello");
    });
  },
);
