import { describe, expect, it, jest } from "@jest/globals";

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  appendCappedLog,
  encodeLengthOrBound,
  utf8UpperBound,
  warnOnceBounded,
} from "./tokenFallback.js";

describe("utf8UpperBound", () => {
  it("is the UTF-8 byte length", () => {
    expect(utf8UpperBound("")).toBe(0);
    expect(utf8UpperBound("abc")).toBe(3);
    expect(utf8UpperBound("é")).toBe(2);
    expect(utf8UpperBound("😀")).toBe(4);
  });
});

describe("encodeLengthOrBound", () => {
  it("returns the encoder length when it succeeds", () => {
    expect(encodeLengthOrBound(() => [1, 2], "hello")).toBe(2);
  });

  it("never throws and falls back to the byte bound", () => {
    const text = "<|endoftext|> code(){}[];😀";
    const n = encodeLengthOrBound(() => {
      throw new Error("Disallowed special token");
    }, text);
    expect(n).toBe(utf8UpperBound(text));
  });
});

describe("warnOnceBounded", () => {
  it("dedupes identical messages and bounds distinct ones", () => {
    const sink = jest.fn();
    for (let i = 0; i < 5; i++) warnOnceBounded("same", sink);
    expect(sink).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 500; i++) warnOnceBounded(`m${i}`, sink);
    // Bounded cache: eviction means later repeats may re-log, but memory is capped.
    expect(sink.mock.calls.length).toBeLessThan(600);
  });

  it("does not create separate entries for quoted or numeric details", () => {
    const sink = jest.fn();
    warnOnceBounded('failed "first" at 12', sink);
    warnOnceBounded('failed "second" at 34', sink);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).not.toContain("first");
  });

  it("re-logs after the TTL expires", () => {
    jest.useFakeTimers();
    const sink = jest.fn();
    warnOnceBounded("ttl", sink);
    jest.advanceTimersByTime(11 * 60_000);
    warnOnceBounded("ttl", sink);
    expect(sink).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});

describe("appendCappedLog", () => {
  it("rotates at the cap, strips control characters and keeps files private", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tfl-"));
    const file = path.join(dir, "logs", "t.log");
    for (let i = 0; i < 20; i++)
      appendCappedLog(file, `line\n${i} ${"x".repeat(50)}`, 400);
    expect(fs.statSync(file).size).toBeLessThanOrEqual(400);
    expect(fs.existsSync(`${file}.1`)).toBe(true);
    expect(
      fs
        .readFileSync(file, "utf8")
        .split("\n")
        .every((l) => !l.includes("\r")),
    ).toBe(true);
    expect(fs.statSync(file).mode & 0o077).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
