import { beforeEach, expect, it, vi } from "vitest";
import { Response } from "node-fetch";
import { fetchUntrustedUrl } from "@opencircuit/fetch";
import { fetchFavicon } from "../../util/fetchFavicon";
import { getUrlContextItems } from "./URLContextProvider";

vi.mock("@opencircuit/fetch", () => ({ fetchUntrustedUrl: vi.fn() }));
vi.mock("../../util/fetchFavicon", () => ({ fetchFavicon: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it("consumes the bounded page body before optional favicon requests", async () => {
  const response = new Response(
    "<html><title>Example</title><body><p>Example content.</p></body></html>",
  );
  vi.mocked(fetchUntrustedUrl).mockResolvedValue(response);
  vi.mocked(fetchFavicon).mockImplementation(async () => {
    expect(response.bodyUsed).toBe(true);
    return undefined;
  });
  const options = { timeout: 1 };
  const items = await getUrlContextItems("https://example.com", options);
  expect(items).toHaveLength(1);
  expect(fetchUntrustedUrl).toHaveBeenCalledWith(
    new URL("https://example.com"),
    {},
    options,
  );
  expect(fetchFavicon).toHaveBeenCalledWith(
    new URL("https://example.com"),
    options,
  );
});

it("rejects unsuccessful pages before fetching favicons", async () => {
  vi.mocked(fetchUntrustedUrl).mockResolvedValue(
    new Response("", { status: 404 }),
  );
  await expect(
    getUrlContextItems("https://example.com/missing"),
  ).rejects.toThrow(/HTTP 404/);
  expect(fetchFavicon).not.toHaveBeenCalled();
});
