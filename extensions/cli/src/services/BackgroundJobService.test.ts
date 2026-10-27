import { once } from "node:events";

import { afterEach, vi } from "vitest";

import { BackgroundJobService } from "./BackgroundJobService.js";

afterEach(() => vi.unstubAllEnvs());

describe("BackgroundJobService", () => {
  it("bounds captured output by character count", () => {
    const service = new BackgroundJobService();
    const job = service.createJob("large output");

    expect(job).not.toBeNull();
    if (!job) return;

    service.appendOutput(job.id, "x".repeat(100000));

    expect(service.getJob(job.id)?.output).toBe("x".repeat(50000));
  });
  it("denies unsupported commands at the background execution boundary", () => {
    const service = new BackgroundJobService();
    const job = service.createJob("env echo blocked");
    if (!job) throw new Error("Missing fixture job");
    expect(() => service.startJob(job.id)).toThrow(/denied by security policy/);
    expect(service.getJob(job.id)?.status).toBe("failed");
  });
  it("uses the fixed shell and filtered environment for actual background children", async () => {
    vi.stubEnv("SHELL", "/nonexistent/untrusted-shell");
    vi.stubEnv("PATH", "/nonexistent/untrusted-bin");
    vi.stubEnv("OC_SECURITY_SYNTHETIC_SECRET", "synthetic");
    vi.stubEnv("BASH_ENV", "/nonexistent/untrusted-profile");
    const service = new BackgroundJobService();
    const job = service.createJob(
      `node -p 'JSON.stringify([process.env.OC_SECURITY_SYNTHETIC_SECRET ?? null, process.env.BASH_ENV ?? null])'`,
    );
    if (!job) throw new Error("Missing fixture job");
    const child = service.startJob(job.id);
    if (!child) throw new Error("Missing fixture child");
    await once(child, "close");
    expect(service.getJob(job.id)?.output.trim()).toBe("[null,null]");
    expect(service.getJob(job.id)?.status).toBe("completed");
  });
});
