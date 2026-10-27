import { createServer, type Server } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { X509Certificate } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchUntrustedUrl } from "./safeFetch.js";
import * as policy from "./ssrfPolicy.js";

const { fixtureRoots } = vi.hoisted(() => ({ fixtureRoots: [] as string[] }));
vi.mock("node:tls", async (original) => ({
  ...(await original<typeof import("node:tls")>()),
  rootCertificates: fixtureRoots,
}));

const servers: Server[] = [];
const cleanups: Array<() => void> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fixtureRoots.length = 0;
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  cleanups.splice(0).forEach((cleanup) => cleanup());
});

async function bind(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test listener");
  return address.port;
}

// Transport fixtures bypass only policy resolution in this test process.
function pinFixture() {
  return vi
    .spyOn(policy, "resolveNetworkDestination")
    .mockImplementation(async (url) => ({
      hostname: url.hostname,
      addresses: [{ address: "127.0.0.1", family: 4 }],
    }));
}

describe("untrusted URL policy", () => {
  it("allows global addresses but never private, metadata or reserved addresses", () => {
    expect(policy.isAllowedDestinationAddress("8.8.8.8")).toBe(true);
    expect(policy.isAllowedDestinationAddress("2606:4700:4700::1111")).toBe(
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
      "0000:0000:0000:0000:0000:ffff:7f00:1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
    ])
      expect(policy.isAllowedDestinationAddress(address), address).toBe(false);
  });

  it("rejects HTTP, userinfo, alternate ports and configuration overrides before DNS", async () => {
    const resolver = vi.fn();
    for (const url of [
      "http://example.com",
      "file:///etc/hosts",
      "https://user@example.com",
      "https://example.com:8080",
    ]) {
      await expect(
        policy.resolveNetworkDestination(new URL(url), resolver),
      ).rejects.toThrow();
    }
    expect(resolver).not.toHaveBeenCalled();
    // Unknown configuration values cannot widen the network policy.
    const options = { verifySsl: false };
    await expect(
      fetchUntrustedUrl("https://127.0.0.1", {}, options),
    ).rejects.toThrow(/disallowed/);
  });

  it("validates every DNS answer and fails closed on resolution errors", async () => {
    const resolver = vi.fn().mockResolvedValue([
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(
      policy.resolveNetworkDestination(
        new URL("https://fixture.invalid"),
        resolver,
      ),
    ).rejects.toThrow(/disallowed/);
    resolver.mockRejectedValue(new Error("synthetic DNS failure"));
    await expect(
      policy.resolveNetworkDestination(
        new URL("https://fixture.invalid"),
        resolver,
      ),
    ).rejects.toThrow(/DNS failure/);
    expect(() =>
      policy.validateResolvedNetworkDestination(
        new URL("https://fixture.invalid"),
        [],
      ),
    ).toThrow();
    expect(() =>
      policy.validateResolvedNetworkDestination(
        new URL("https://fixture.invalid"),
        [{ address: "8.8.8.8", family: 6 }],
      ),
    ).toThrow();
  });

  it("pins the actual socket, preserves Host and ignores proxy, credentials and agent overrides", async () => {
    let proxyHits = 0;
    const proxyPort = await bind(
      createServer((_req, res) => {
        proxyHits++;
        res.end("proxy");
      }),
    );
    const port = await bind(
      createServer((req, res) => {
        res.end(
          JSON.stringify({
            host: req.headers.host,
            leaked: req.headers["x-synthetic-leak"],
            remote: req.socket.localAddress,
          }),
        );
      }),
    );
    const resolution = pinFixture();
    vi.stubEnv("HTTP_PROXY", `http://127.0.0.1:${proxyPort}`);
    vi.stubEnv("HTTPS_PROXY", `http://127.0.0.1:${proxyPort}`);
    vi.stubEnv("https_proxy", `http://127.0.0.1:${proxyPort}`);
    vi.stubEnv("ALL_PROXY", `http://127.0.0.1:${proxyPort}`);
    const response = await fetchUntrustedUrl(
      `http://fixture.invalid:${port}/`,
      {
        agent: () => {
          throw new Error("Untrusted agent callback must not execute");
        },
      },
      {
        headers: { "X-Synthetic-Leak": "synthetic" },
        proxy: `http://127.0.0.1:${proxyPort}`,
        verifySsl: false,
        caBundlePath: "/nonexistent/ca",
        clientCertificate: {
          cert: "/nonexistent/cert",
          key: "/nonexistent/key",
        },
      },
    );
    expect(await response.json()).toEqual({
      host: `fixture.invalid:${port}`,
      remote: "127.0.0.1",
    });
    expect(proxyHits).toBe(0);
    expect(resolution).toHaveBeenCalledTimes(1);
  });

  it("never follows a redirect and never re-resolves the destination", async () => {
    let hits = 0;
    const port = await bind(
      createServer((_req, res) => {
        hits++;
        res.writeHead(302, { Location: "https://127.0.0.1/metadata" });
        res.end();
      }),
    );
    const resolution = pinFixture();
    resolution
      .mockResolvedValueOnce({
        hostname: "fixture.invalid",
        addresses: [{ address: "127.0.0.1", family: 4 }],
      })
      .mockRejectedValue(new Error("DNS changed after validation"));
    const response = await fetchUntrustedUrl(
      `http://fixture.invalid:${port}/`,
      { redirect: "follow" },
    );
    expect(response.status).toBe(302);
    expect(hits).toBe(1);
    expect(resolution).toHaveBeenCalledTimes(1);
  });

  it("enforces TLS verification even when configuration disables it", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ocircuit-tls-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const keyPath = path.join(dir, "key.pem"),
      certPath = path.join(dir, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:P-256",
        "-sha256",
        "-nodes",
        "-keyout",
        keyPath,
        "-out",
        certPath,
        "-days",
        "1",
        "-subj",
        "/CN=fixture.invalid",
      ],
      { stdio: "ignore" },
    );
    const cert = readFileSync(certPath);
    const parsed = new X509Certificate(cert);
    expect(parsed.subject).toBe(parsed.issuer);
    expect(parsed.publicKey.asymmetricKeyDetails?.namedCurve).toBe(
      "prime256v1",
    );
    expect(Date.parse(parsed.validTo)).toBeGreaterThan(Date.now());
    expect(Date.parse(parsed.validFrom)).toBeLessThanOrEqual(Date.now());
    const details = execFileSync(
      "openssl",
      ["x509", "-in", certPath, "-text", "-noout"],
      { encoding: "utf8" },
    );
    expect(details).toContain("ecdsa-with-SHA256");
    let httpHits = 0;
    const port = await bind(
      createTlsServer({ key: readFileSync(keyPath), cert }, (_req, res) => {
        httpHits++;
        res.end();
      }),
    );
    pinFixture();
    await expect(
      fetchUntrustedUrl(
        `https://fixture.invalid:${port}/`,
        {},
        { verifySsl: false },
      ),
    ).rejects.toThrow(/self.signed|certificate/i);
    expect(httpHits).toBe(0);
    fixtureRoots.push(cert.toString());
    expect(
      (await fetchUntrustedUrl(`https://fixture.invalid:${port}/`)).ok,
    ).toBe(true);
    await expect(
      fetchUntrustedUrl(`https://wrong.invalid:${port}/`),
    ).rejects.toThrow(/hostname|altnames/i);
    expect(httpHits).toBe(1);
  });

  it("limits body size and times out stalled responses", async () => {
    const port = await bind(
      createServer((req, res) => {
        if (req.url === "/large") {
          res.end("x".repeat(1_000_001));
        }
        if (req.url === "/body-stall") {
          res.write("partial");
        }
      }),
    );
    pinFixture();
    const response = await fetchUntrustedUrl(
      `http://fixture.invalid:${port}/large`,
    );
    await expect(response.text()).rejects.toThrow(/size/i);
    await expect(
      fetchUntrustedUrl(
        `http://fixture.invalid:${port}/stall`,
        {},
        { timeout: 0.1001 },
      ),
    ).rejects.toThrow(/timeout|socket|abort/i);
    const stalled = await fetchUntrustedUrl(
      `http://fixture.invalid:${port}/body-stall`,
      {},
      { timeout: 0.1 },
    );
    await expect(stalled.text()).rejects.toThrow(/abort/i);
  });
  it("includes DNS lookup time in the deadline", async () => {
    vi.spyOn(policy, "resolveNetworkDestination").mockImplementation(
      () => new Promise(() => {}),
    );
    await expect(
      fetchUntrustedUrl("https://fixture.invalid", {}, { timeout: 0.1 }),
    ).rejects.toThrow(/timeout/);
  });
});
