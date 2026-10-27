import { jest } from "@jest/globals";
import { Response } from "node-fetch";

const safeFetch =
  jest.fn<typeof import("@opencircuit/fetch").fetchUntrustedUrl>();
jest.unstable_mockModule("@opencircuit/fetch", () => ({
  fetchUntrustedUrl: safeFetch,
}));
const { findFaviconPath, getFaviconBase64, fetchFavicon } = await import(
  "./fetchFavicon.js"
);

afterEach(() => safeFetch.mockReset());

describe("safe favicon fetches", () => {
  it.each([
    "/favicon.ico",
    "favicon.ico",
    "https://cdn.example.com/favicon.ico",
  ])("resolves icon href %s through the safe transport", async (href) => {
    safeFetch.mockResolvedValue(
      new Response(`<link rel="icon" href="${href}">`),
    );
    const url = new URL("https://example.com");
    expect(await findFaviconPath(url)).toBe(new URL(href, url).href);
    expect(safeFetch).toHaveBeenCalledWith(url.origin, {}, undefined);
  });

  it("returns no favicon when the page has no icon", async () => {
    safeFetch.mockResolvedValue(new Response("<html></html>"));
    expect(await fetchFavicon(new URL("https://example.com"))).toBeUndefined();
    expect(safeFetch).toHaveBeenCalledTimes(1);
  });

  it("fetches page and icon through the same safe boundary", async () => {
    safeFetch.mockResolvedValueOnce(
      new Response('<link rel="icon" href="/favicon.ico">'),
    );
    safeFetch.mockResolvedValueOnce(
      new Response("icon data", { headers: { "Content-Type": "image/png" } }),
    );
    expect(await fetchFavicon(new URL("https://example.com"))).toBe(
      "data:image/png;base64,aWNvbiBkYXRh",
    );
    expect(safeFetch).toHaveBeenNthCalledWith(
      2,
      "https://example.com/favicon.ico",
      {},
      undefined,
    );
  });

  it("uses the default MIME type when none is present", async () => {
    const response = new Response(Buffer.from("icon data"));
    safeFetch.mockResolvedValue(response);
    expect(await getFaviconBase64("https://example.com/favicon.ico")).toBe(
      "data:image/x-icon;base64,aWNvbiBkYXRh",
    );
  });

  it.each([
    () => findFaviconPath(new URL("https://example.com")),
    () => getFaviconBase64("https://example.com/favicon.ico"),
  ])(
    "treats rejected destinations as optional-icon failures",
    async (fetchIcon) => {
      safeFetch.mockRejectedValue(
        new Error("Destination disallowed by policy"),
      );
      expect(await fetchIcon()).toBeUndefined();
    },
  );
});
