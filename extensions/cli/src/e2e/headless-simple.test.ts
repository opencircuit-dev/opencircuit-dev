import {
  createTestContext,
  cleanupTestContext,
  runCLI,
  createTestConfig,
} from "../test-helpers/cli-helpers.js";
import {
  setupMockLLMTest,
  cleanupMockLLMServer,
  createMockLLMConfig,
  createMockLLMServer,
  type MockLLMServer,
} from "../test-helpers/mock-llm-server.js";

describe("E2E: Headless Mode (Simple)", () => {
  let context: any;
  let mockServer: MockLLMServer | undefined;

  const testConfig = `name: Test Assistant
version: 1.0.0
schema: v1
models:
  - model: gpt-4
    provider: openai
    apiKey: test-key
    roles:
      - chat`;

  const testEnv = { OPENAI_API_KEY: "test-key" };

  beforeEach(async () => {
    context = await createTestContext();
  });

  afterEach(async () => {
    if (mockServer) {
      await cleanupMockLLMServer(mockServer);
      mockServer = undefined;
    }
    await cleanupTestContext(context);
  });

  describe("basic headless functionality", () => {
    it("should output response and exit with -p flag", async () => {
      // Use a local mock LLM server (see mock-llm-server.ts) rather than
      // real credentials, so the subprocess's LLM call is deterministic
      // and requires no external infrastructure.
      mockServer = await setupMockLLMTest(context, {
        response: "Hello from the mock LLM!",
      });

      const result = await runCLI(context, {
        args: ["-p", "--config", context.configPath, "Say hello"],
        timeout: 15000,
      });

      expect(result.stdout).toContain("Hello from the mock LLM!");
      expect(result.exitCode).toBe(0);
    }, 20000);

    it("should handle streaming responses in headless mode", async () => {
      mockServer = await setupMockLLMTest(context, {
        response: "Streaming response content",
        streaming: true,
      });

      const result = await runCLI(context, {
        args: ["-p", "--config", context.configPath, "Stream a response"],
        timeout: 15000,
      });

      expect(result.stdout).toContain("Streaming response content");
      expect(result.exitCode).toBe(0);
      expect(mockServer.requests).toHaveLength(1);
    }, 20000);

    it("should fail gracefully when config is invalid", async () => {
      // Test with invalid config
      await createTestConfig(
        context,
        `invalid: yaml
no models here`,
      );

      const result = await runCLI(context, {
        args: ["-p", "--config", context.configPath, "Test"],
        expectError: true,
      });

      expect(result.exitCode).not.toBe(0);
    });

    it("should work with minimal config", async () => {
      // A minimal single-model config, using the mock LLM helper's
      // default single-model shape (createMockLLMConfig) rather than the
      // broader multi-field testConfig used by the other tests.
      const server = await createMockLLMServer({
        response: "Minimal config response",
      });
      mockServer = server;

      const configContent = createMockLLMConfig(server);
      await createTestConfig(context, configContent);

      const result = await runCLI(context, {
        args: ["-p", "--config", context.configPath, "Hi"],
        timeout: 15000,
      });

      expect(result.stdout).toContain("Minimal config response");
      expect(result.exitCode).toBe(0);
    }, 20000);

    it("should handle missing prompt in headless mode", async () => {
      await createTestConfig(context, testConfig);

      const result = await runCLI(context, {
        args: ["-p", "--config", context.configPath],
        env: testEnv,
        expectError: true,
      });

      expect(result.exitCode).not.toBe(0);
    });

    it("should accept piped input with -p flag", async () => {
      await createTestConfig(context, testConfig);

      const result = await runCLI(context, {
        args: ["-p", "--config", context.configPath],
        env: testEnv,
        input: "Hello from piped input",
        expectError: true,
      });

      expect(result.stderr).not.toContain("You:");
      expect(result.stdout).not.toContain("You:");
      expect(result.exitCode).not.toBe(0);
    });

    it("should combine piped input with prompt argument", async () => {
      await createTestConfig(context, testConfig);

      const result = await runCLI(context, {
        args: ["-p", "--config", context.configPath, "Command line argument"],
        env: testEnv,
        input: "Piped input to be combined",
        expectError: true,
      });

      expect(result.stderr).not.toContain("You:");
      expect(result.stdout).not.toContain("You:");
      expect(result.exitCode).not.toBe(0);
    });

    it("should work with only prompt argument", async () => {
      await createTestConfig(context, testConfig);

      const result = await runCLI(context, {
        args: [
          "-p",
          "--config",
          context.configPath,
          "Only command line argument",
        ],
        env: testEnv,
        expectError: true,
      });

      expect(result.stderr).not.toContain("You:");
      expect(result.stdout).not.toContain("You:");
      expect(result.exitCode).not.toBe(0);
    });
  });
});
