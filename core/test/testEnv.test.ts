describe("Test environment", () => {
  test("should have OCIRCUIT_GLOBAL_DIR env var set to .ocircuit-test", () => {
    expect(process.env.OCIRCUIT_GLOBAL_DIR).toBeDefined();
    expect(process.env.OCIRCUIT_GLOBAL_DIR)?.toMatch(/\.ocircuit-test$/);
  });
});
