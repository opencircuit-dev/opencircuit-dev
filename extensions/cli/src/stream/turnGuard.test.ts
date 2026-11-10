import { describe, expect, it } from "vitest";

import {
  ACTION_CLASSES,
  DEFAULT_LIMITS,
  HARD_CEILINGS,
  actionClassForTool,
  createTurnGuard,
  resolveLimits,
} from "./turnGuard.js";

const NAMES = ["Read", "Write", "Bash"];

function setup(overrides: Partial<typeof DEFAULT_LIMITS> = {}, now = () => 0) {
  const guard = createTurnGuard({
    limits: { ...DEFAULT_LIMITS, ...overrides },
    now,
  });
  const generation = guard.registerRegistry(NAMES);
  return { guard, generation };
}

const calls = (n: number, name = "Read", prefix = "c") =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name }));

describe("resolveLimits", () => {
  it("uses defaults when nothing is configured", () => {
    const r = resolveLimits({});
    expect(r.limits).toEqual(DEFAULT_LIMITS);
    expect(r.invalid).toEqual([]);
  });

  it("falls back to the default and reports invalid values; never disables", () => {
    const r = resolveLimits({
      config: { maxCalls: 0, maxIdenticalFailures: -1, maxCompactions: 1.5 },
    });
    expect(r.limits.maxCalls).toBe(DEFAULT_LIMITS.maxCalls);
    expect(r.limits.maxIdenticalFailures).toBe(
      DEFAULT_LIMITS.maxIdenticalFailures,
    );
    expect(r.limits.maxCompactions).toBe(DEFAULT_LIMITS.maxCompactions);
    expect(r.invalid.sort()).toEqual(
      ["maxCalls", "maxCompactions", "maxIdenticalFailures"].sort(),
    );
  });

  it("rejects unknown keys and non-finite values", () => {
    const r = resolveLimits({
      config: { bogus: 5, maxCalls: Number.POSITIVE_INFINITY } as any,
    });
    expect(r.limits.maxCalls).toBe(DEFAULT_LIMITS.maxCalls);
    expect(r.invalid).toContain("bogus");
    expect(r.invalid).toContain("maxCalls");
  });

  it("clamps every source to the hard ceiling", () => {
    const r = resolveLimits({
      config: { maxCalls: 100000 },
      org: { maxCompactions: 10 ** 6 },
    });
    expect(r.limits.maxCalls).toBe(HARD_CEILINGS.maxCalls);
    expect(r.limits.maxCompactions).toBe(HARD_CEILINGS.maxCompactions);
  });

  it("orders org over config, and lets environment only lower", () => {
    const r = resolveLimits({
      config: { maxCalls: 300 },
      org: { maxCalls: 200 },
      env: { maxCalls: 400 },
    });
    expect(r.limits.maxCalls).toBe(200);
    expect(
      resolveLimits({ config: { maxCalls: 300 }, env: { maxCalls: 50 } }).limits
        .maxCalls,
    ).toBe(50);
  });

  it("session override applies only interactively and only up to the org maximum", () => {
    expect(
      resolveLimits({ session: { maxCalls: 400 }, interactive: true }).limits
        .maxCalls,
    ).toBe(400);
    expect(
      resolveLimits({ session: { maxCalls: 400 }, interactive: false }).limits
        .maxCalls,
    ).toBe(DEFAULT_LIMITS.maxCalls);
    expect(
      resolveLimits({
        session: { maxCalls: 400 },
        org: { maxCalls: 150 },
        interactive: true,
      }).limits.maxCalls,
    ).toBe(150);
  });
});

describe("reserve / record", () => {
  it("accepts a batch within the cap and refuses a batch that would cross it", () => {
    const { guard, generation } = setup({ maxCalls: 5 });
    expect(guard.reserve(calls(3), generation).ok).toBe(true);
    const crossing = guard.reserve(calls(3, "Read", "d"), generation);
    expect(crossing).toMatchObject({ ok: false, reason: "calls" });
    expect(guard.snapshot().consumedCalls).toBe(3);
  });

  it("accepts a batch of exactly the remaining capacity and refuses one more", () => {
    const { guard, generation } = setup({ maxCalls: 5 });
    expect(guard.reserve(calls(5), generation).ok).toBe(true);
    expect(guard.reserve(calls(1, "Read", "z"), generation).ok).toBe(false);
  });

  it("counts a reservation once, at reserve time, never on record", () => {
    const { guard, generation } = setup({ maxCalls: 10 });
    const r = guard.reserve(calls(2), generation);
    if (!r.ok) throw new Error("expected ok");
    const t = [...r.reservation.tokens.values()];
    guard.record(t[0], { status: "done", actionClass: "read", signature: "s" });
    guard.record(t[1], {
      status: "errored",
      actionClass: "read",
      signature: "s2",
    });
    expect(guard.snapshot().consumedCalls).toBe(2);
  });

  it("rejects empty, duplicate and malformed call IDs", () => {
    const { guard, generation } = setup();
    expect(guard.reserve([], generation)).toMatchObject({
      ok: false,
      reason: "invalid_call",
    });
    expect(
      guard.reserve(
        [
          { id: "a", name: "Read" },
          { id: "a", name: "Read" },
        ],
        generation,
      ),
    ).toMatchObject({ ok: false, reason: "invalid_call" });
    expect(guard.reserve([{ id: "", name: "Read" }], generation)).toMatchObject(
      { ok: false },
    );
    expect(
      guard.reserve([{ id: "x\u0000y", name: "Read" }], generation),
    ).toMatchObject({ ok: false });
    expect(
      guard.reserve([{ id: "a".repeat(200), name: "Read" }], generation),
    ).toMatchObject({ ok: false });
    expect(guard.snapshot().consumedCalls).toBe(0);
    expect(guard.counters.invalid_call_id).toBeGreaterThanOrEqual(4);
  });

  it("rejects the whole batch for an unadvertised tool before consuming anything", () => {
    const { guard, generation } = setup();
    const r = guard.reserve(
      [...calls(2), { id: "z", name: "Delete" }],
      generation,
    );
    expect(r).toMatchObject({ ok: false, reason: "unknown_tool" });
    expect(guard.snapshot().consumedCalls).toBe(0);
    expect(guard.counters.unknown_tool).toBe(1);
  });

  it("rejects an unknown or evicted registry generation (keeps current + previous)", () => {
    const { guard, generation } = setup();
    expect(guard.reserve(calls(1), generation + 99)).toMatchObject({
      ok: false,
      reason: "unknown_tool",
    });
    const g2 = guard.registerRegistry(["Read", "Write", "Bash", "List"]);
    const g3 = guard.registerRegistry(["Read"]);
    expect(g3).toBeGreaterThan(g2);
    expect(guard.reserve(calls(1, "Read", "p"), generation)).toMatchObject({
      ok: false,
    });
    expect(guard.reserve(calls(1, "Read", "q"), g2).ok).toBe(true);
  });

  it("ignores a second record for the same token and rejects foreign tokens", () => {
    const { guard, generation } = setup();
    const r = guard.reserve(calls(1), generation);
    if (!r.ok) throw new Error("expected ok");
    const token = [...r.reservation.tokens.values()][0];
    const outcome = {
      status: "errored" as const,
      actionClass: "read" as const,
      signature: "s",
    };
    expect(guard.record(token, outcome)).toBe("recorded");
    expect(guard.record(token, outcome)).toBe("duplicate");
    expect(guard.record("not-a-token", outcome)).toBe("unknown");
    expect(guard.counters.duplicate_record).toBe(1);
    expect(guard.snapshot().identicalFailures).toBe(1);
  });

  it("rejects a token after its registry generation is replaced", () => {
    const { guard, generation } = setup();
    const r = guard.reserve(calls(1), generation);
    if (!r.ok) throw new Error("expected ok");
    const token = [...r.reservation.tokens.values()][0];
    guard.registerRegistry(["Read"]);
    expect(
      guard.record(token, {
        status: "done",
        actionClass: "read",
        signature: "stale",
      }),
    ).toBe("stale");
    expect(guard.counters.stale_reservation).toBe(1);
  });

  it("discards results that arrive after a breach and counts them", () => {
    const { guard, generation } = setup({ maxCalls: 2 });
    const r = guard.reserve(calls(2), generation);
    if (!r.ok) throw new Error("expected ok");
    guard.reserve(calls(1, "Read", "x"), generation); // crosses the cap -> breach
    expect(guard.check()).toMatchObject({ ok: false });
    const token = [...r.reservation.tokens.values()][0];
    expect(
      guard.record(token, {
        status: "done",
        actionClass: "read",
        signature: "s",
      }),
    ).toBe("late");
    expect(guard.counters.late_result_discarded).toBe(1);
  });

  it("mints unguessable, unique tokens and exposes no provider id in them", () => {
    const { guard, generation } = setup();
    const r = guard.reserve(calls(3), generation);
    if (!r.ok) throw new Error("expected ok");
    const tokens = [...r.reservation.tokens.values()];
    expect(new Set(tokens).size).toBe(3);
    for (const t of tokens) expect(t).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("check()", () => {
  const fail = (sig: string, actionClass: any = "shell") =>
    ({ status: "errored", actionClass, signature: sig }) as const;

  it("stops at exactly N identical failures and emits one breach", () => {
    const { guard, generation } = setup({ maxIdenticalFailures: 5 });
    for (let i = 0; i < 4; i++) {
      const r = guard.reserve(calls(1, "Bash", `f${i}`), generation);
      if (!r.ok) throw new Error("expected ok");
      guard.record(
        [...r.reservation.tokens.values()][0],
        fail("npm:EALLOWSCRIPTS"),
      );
      expect(guard.check().ok).toBe(true);
    }
    const r = guard.reserve(calls(1, "Bash", "f4"), generation);
    if (!r.ok) throw new Error("expected ok");
    guard.record(
      [...r.reservation.tokens.values()][0],
      fail("npm:EALLOWSCRIPTS"),
    );
    const c = guard.check();
    expect(c).toMatchObject({
      ok: false,
      breach: { reason: "identical_failure" },
    });
    expect(guard.check()).toEqual(c);
    expect(guard.counters.breach.identical_failure).toBe(1);
  });

  it("does not merge different failure signatures", () => {
    const { guard, generation } = setup({ maxIdenticalFailures: 3 });
    for (let i = 0; i < 6; i++) {
      const r = guard.reserve(calls(1, "Bash", `v${i}`), generation);
      if (!r.ok) throw new Error("expected ok");
      guard.record([...r.reservation.tokens.values()][0], fail(`sig-${i}`));
    }
    expect(guard.check().ok).toBe(true);
  });

  it("breaches after repeated denials of one action class, not across classes", () => {
    const { guard, generation } = setup({ maxDenialsPerClass: 2 });
    const deny = (id: string, name: string, cls: any) => {
      const r = guard.reserve([{ id, name }], generation);
      if (!r.ok) throw new Error("expected ok");
      guard.record([...r.reservation.tokens.values()][0], {
        status: "canceled",
        actionClass: cls,
        signature: id,
      });
    };
    deny("a", "Bash", "shell");
    deny("b", "Write", "write");
    expect(guard.check().ok).toBe(true);
    deny("c", "Bash", "shell");
    expect(guard.check()).toMatchObject({
      ok: false,
      breach: { reason: "denial", evidence: { actionClass: "shell" } },
    });
  });

  it("breaches on compactions, wall clock and total calls", () => {
    const a = setup({ maxCompactions: 2 });
    a.guard.noteCompaction();
    expect(a.guard.check().ok).toBe(true);
    a.guard.noteCompaction();
    expect(a.guard.check()).toMatchObject({
      ok: false,
      breach: { reason: "compaction" },
    });

    let t = 0;
    const b = setup({ maxWallClockMs: 1000 }, () => t);
    t = 999;
    expect(b.guard.check().ok).toBe(true);
    t = 1000;
    expect(b.guard.check()).toMatchObject({
      ok: false,
      breach: { reason: "wall_clock" },
    });

    const c = setup({ maxCalls: 1 });
    c.guard.reserve(calls(2), c.generation);
    expect(c.guard.check()).toMatchObject({
      ok: false,
      breach: { reason: "calls" },
    });
  });

  it("never exposes raw signatures; evidence uses short opaque ids that differ per turn", () => {
    const run = () => {
      const { guard, generation } = setup({ maxIdenticalFailures: 1 });
      const r = guard.reserve(calls(1, "Bash"), generation);
      if (!r.ok) throw new Error("expected ok");
      guard.record(
        [...r.reservation.tokens.values()][0],
        fail("secret-path-/Users/x"),
      );
      return guard.check();
    };
    const a = run();
    const b = run();
    if (a.ok || b.ok) throw new Error("expected breach");
    const ida = (a.breach.evidence as any).topSignatureIds[0];
    expect(ida).toMatch(/^[0-9a-f]{8}$/);
    expect(JSON.stringify(a)).not.toContain("secret-path");
    expect(ida).not.toBe((b.breach.evidence as any).topSignatureIds[0]);
  });

  it("bounds the signature table without losing the failure count", () => {
    const { guard, generation } = setup({
      maxCalls: 5000,
      maxIdenticalFailures: 10,
    });
    for (let i = 0; i < 2000; i++) {
      const r = guard.reserve(calls(1, "Bash", `u${i}`), generation);
      if (!r.ok) throw new Error("expected ok");
      guard.record([...r.reservation.tokens.values()][0], fail(`unique-${i}`));
    }
    expect(guard.snapshot().signatureTableSize).toBeLessThanOrEqual(1025);
  });
});

describe("actionClassForTool", () => {
  it("maps built-ins to the fixed enum and everything else to other", () => {
    expect(actionClassForTool("Read")).toBe("read");
    expect(actionClassForTool("List")).toBe("read");
    expect(actionClassForTool("Write")).toBe("write");
    expect(actionClassForTool("Edit")).toBe("write");
    expect(actionClassForTool("MultiEdit")).toBe("write");
    expect(actionClassForTool("Bash")).toBe("shell");
    expect(actionClassForTool("CheckBackgroundJob")).toBe("shell");
    expect(actionClassForTool("Fetch")).toBe("network");
    expect(actionClassForTool("Search")).toBe("search");
    expect(actionClassForTool("Subagent")).toBe("subagent");
    expect(actionClassForTool("mcp__server__tool")).toBe("mcp");
    expect(actionClassForTool("Checklist")).toBe("other");
    expect(ACTION_CLASSES).toContain("other");
  });
});

describe("hardening", () => {
  it("rejects format characters, lone surrogates and over-long UTF-8 ids", () => {
    const { guard } = setup();
    const gen = guard.registerRegistry(["Bash"]);
    for (const id of ["a\u202eb", "a\ud800b", "é".repeat(100)]) {
      expect(guard.reserve([{ id, name: "Bash" }], gen)).toMatchObject({
        ok: false,
        reason: "invalid_call",
      });
    }
  });
});
