import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveLimits } from "./turnGuard.js";
import {
  getSessionOverride,
  readOrgPolicy,
  setSessionOverride,
} from "./turnGuardPolicy.js";

const dirs: string[] = [];
function policy(content: string, mode: number) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tgp-"));
  dirs.push(d);
  const f = path.join(d, "turn-guard.json");
  fs.writeFileSync(f, content);
  fs.chmodSync(f, mode);
  return f;
}
afterEach(() => {
  dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  setSessionOverride({});
});

describe("readOrgPolicy", () => {
  it("reads a trusted file and treats a missing file as no policy", () => {
    const f = policy('{"maxCalls": 20}', 0o644);
    expect(readOrgPolicy([f]).limits).toEqual({ maxCalls: 20 });
    expect(readOrgPolicy(["/nonexistent/x.json"])).toEqual({ limits: {} });
  });

  it("ignores group/world-writable, foreign-owned and malformed files", () => {
    expect(readOrgPolicy([policy('{"maxCalls": 20}', 0o666)]).rejected).toBe(
      "writable_by_others",
    );
    expect(
      readOrgPolicy([policy('{"maxCalls": 20}', 0o644)], 424242).rejected,
    ).toBe("untrusted_owner");
    expect(readOrgPolicy([policy("[1]", 0o644)]).rejected).toBe("malformed");
    expect(readOrgPolicy([policy("{nope", 0o644)]).rejected).toBe("unreadable");
  });
});

describe("limit precedence with org and session sources", () => {
  it("org lowers the limit and caps a session raise; session applies only interactively", () => {
    const org = { maxCalls: 20 };
    setSessionOverride({ maxCalls: 400 });
    const interactive = resolveLimits({
      org,
      session: getSessionOverride(),
      interactive: true,
    });
    expect(interactive.limits.maxCalls).toBe(20);
    setSessionOverride({ maxCalls: 10 });
    expect(
      resolveLimits({ org, session: getSessionOverride(), interactive: true })
        .limits.maxCalls,
    ).toBe(10);
    expect(
      resolveLimits({ org, session: getSessionOverride(), interactive: false })
        .limits.maxCalls,
    ).toBe(20);
  });
});
