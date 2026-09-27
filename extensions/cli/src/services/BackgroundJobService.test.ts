import { BackgroundJobService } from "./BackgroundJobService.js";

describe("BackgroundJobService", () => {
  it("bounds captured output by character count", () => {
    const service = new BackgroundJobService();
    const job = service.createJob("large output");

    expect(job).not.toBeNull();
    if (!job) return;

    service.appendOutput(job.id, "x".repeat(100000));

    expect(service.getJob(job.id)?.output).toBe("x".repeat(50000));
  });
});
