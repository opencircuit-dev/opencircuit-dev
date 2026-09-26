import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenCircuitApiError, OpenCircuitClient } from "./OpenCircuitClient.js";

const responses: Response[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

function createClient() {
  fetchMock = vi.fn(async () => responses.shift()!);
  return new OpenCircuitClient({
    baseUrl: "https://api.example.test/",
    accessToken: "test-token",
    fetch: fetchMock as unknown as typeof fetch,
  });
}

afterEach(() => {
  responses.length = 0;
  vi.restoreAllMocks();
});

describe("OpenCircuitClient", () => {
  it("gets an assistant by owner and package slug", async () => {
    const result = {
      ownerSlug: "opencircuit-dev",
      packageSlug: "default-cli-config",
      configResult: {
        config: { name: "Default" },
        configLoadInterrupted: false,
      },
    };
    responses.push(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const client = createClient();
    await expect(
      client.getAssistant({
        ownerSlug: "opencircuit-dev",
        packageSlug: "default-cli-config",
        organizationId: "org id",
      }),
    ).resolves.toEqual(result);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.example.test/ide/get-assistant/opencircuit-dev/default-cli-config?organizationId=org+id",
    );
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("Authorization")).toBe("Bearer test-token");
    expect(headers.get("Accept")).toBe("application/json");
  });

  it("lists assistants", async () => {
    const result = [{ ownerSlug: "opencircuit-dev", packageSlug: "one" }];
    responses.push(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const client = createClient();
    await expect(
      client.listAssistants({ alwaysUseProxy: "false" }),
    ).resolves.toEqual(result);

    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.example.test/ide/list-assistants?alwaysUseProxy=false",
    );
  });

  it("synchronizes secrets with a JSON POST", async () => {
    const request = {
      fqsns: [{ packageSlugs: [], secretName: "API_KEY" }],
    };
    const result = [{ found: true, value: "secret" }];
    responses.push(
      new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const client = createClient();
    await expect(
      client.syncSecrets({ syncSecretsRequest: request }),
    ).resolves.toEqual(result);

    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify(request),
    });
    const headers = new Headers(
      (fetchMock.mock.calls[0][1] as RequestInit).headers,
    );
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer test-token");
  });

  it("throws a typed error for unsuccessful API responses", async () => {
    responses.push(
      new Response("not found", { status: 404, statusText: "Not Found" }),
    );

    const client = createClient();
    await expect(
      client.getAssistant({ ownerSlug: "missing", packageSlug: "missing" }),
    ).rejects.toMatchObject({
      constructor: OpenCircuitApiError,
      status: 404,
      statusText: "Not Found",
    });
  });
});
