import { requestOptionsSchema } from "./models.js";

describe("requestOptionsSchema", () => {
  it("rejects configuration that would authorize private URL destinations", () => {
    expect(() =>
      requestOptionsSchema.parse({
        localUrlOrigins: ["http://localhost:3000"],
      }),
    ).toThrow();
  });

  it("rejects non-string local URL origins", () => {
    expect(
      requestOptionsSchema.safeParse({
        localUrlOrigins: [3000],
      }).success,
    ).toBe(false);
  });
});
