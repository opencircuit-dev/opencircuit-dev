import { requestOptionsSchema } from "./models.js";

describe("requestOptionsSchema", () => {
  it("preserves trusted local URL origins", () => {
    expect(
      requestOptionsSchema.parse({
        localUrlOrigins: ["http://localhost:3000"],
      }),
    ).toEqual({
      localUrlOrigins: ["http://localhost:3000"],
    });
  });

  it("rejects non-string local URL origins", () => {
    expect(
      requestOptionsSchema.safeParse({
        localUrlOrigins: [3000],
      }).success,
    ).toBe(false);
  });
});
