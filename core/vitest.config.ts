import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: "./test/vitest.global-setup.ts",
    setupFiles: "./test/vitest.setup.ts",
    fileParallelism: false,
    include: ["**/*.vitest.ts"],
  },
});
