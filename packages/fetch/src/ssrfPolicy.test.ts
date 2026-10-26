import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { fetchUntrustedUrl } from "./safeFetch.js";
import {
  isAllowedDestinationAddress,
  resolveNetworkDestination,
  validateResolvedNetworkDestination,
} from "./ssrfPolicy.js";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
});

async function startServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<{ origin: string; server: ReturnType<typeof createServer> }> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port");
  }
  return {
    origin: `http://localhost:${address.port}`,
    server,
  };
}

describe("SSRF destination policy", () => {
  it("allows public IPs and rejects reserved, private, loopback, and metadata ranges", () => {
    expect(isAllowedDestinationAddress("8.8.8.8", false)).toBe(true);
    expect(isAllowedDestinationAddress("2606:4700:4700::1111", false)).toBe(
      true,
    );
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "224.0.0.1",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
    ]) {
      expect(isAllowedDestinationAddress(address, false)).toBe(false);
    }
    expect(isAllowedDestinationAddress("10.0.0.1", true)).toBe(true);
    expect(isAllowedDestinationAddress("169.254.169.254", true)).toBe(false);
  });

  it("rejects mixed local and public DNS answers", () => {
    expect(() =>
      validateResolvedNetworkDestination(
        new URL("http://fixture.example"),
        [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.12", family: 4 },
        ],
        { localUrlOrigins: ["http://fixture.example"] },
      ),
    ).toThrow(/mixed local and public destinations/);
  });

  it("rejects credentials, unsupported schemes, and unapproved ports", async () => {
    await expect(
      resolveNetworkDestination(new URL("file:///etc/hosts")),
    ).rejects.toThrow(/HTTP\(S\)/);
    await expect(
      resolveNetworkDestination(new URL("http://user:pass@example.com")),
    ).rejects.toThrow(/credentials/);
    await expect(
      resolveNetworkDestination(new URL("http://example.com:8080")),
    ).rejects.toThrow(/non-default port/);
  });

  it("allows exact trusted local origins and connects to the pinned address", async () => {
    const { origin } = await startServer((request, response) => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end(
        `${request.url}:${request.headers["x-synthetic-leak"] ?? "absent"}`,
      );
    });
    const requestOptions = {
      localUrlOrigins: [origin],
      proxy: "http://127.0.0.1:1",
      headers: { "X-Synthetic-Leak": "must-not-be-forwarded" },
    };
    const response = await fetchUntrustedUrl(
      `${origin}/allowed`,
      {},
      requestOptions,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("/allowed:absent");
  });

  it("does not follow redirects to another destination", async () => {
    let targetHits = 0;
    const { origin } = await startServer((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { Location: "/target" });
        response.end();
      } else if (request.url === "/target") {
        targetHits += 1;
        response.writeHead(200);
        response.end("target");
      } else {
        response.writeHead(404);
        response.end();
      }
    });

    const response = await fetchUntrustedUrl(
      `${origin}/redirect`,
      {},
      { localUrlOrigins: [origin] },
    );

    expect(response.status).toBe(302);
    expect(targetHits).toBe(0);
  });

  it("rejects local destinations without an exact trusted origin", async () => {
    const { origin } = await startServer((_request, response) => {
      response.writeHead(200);
      response.end("local");
    });

    await expect(fetchUntrustedUrl(origin)).rejects.toThrow();
  });

  it("limits response size", async () => {
    const { origin } = await startServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("x".repeat(1_000_001));
    });

    const response = await fetchUntrustedUrl(
      origin,
      {},
      {
        localUrlOrigins: [origin],
      },
    );
    await expect(response.text()).rejects.toThrow(/size/i);
  });
});
