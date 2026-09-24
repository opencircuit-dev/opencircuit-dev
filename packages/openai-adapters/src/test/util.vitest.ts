import { fetchwithRequestOptions } from "@opencircuit/fetch";
import { afterEach, describe, expect, test, vi } from "vitest";
import { customFetch } from "../util.js";

vi.mock("@opencircuit/fetch", async () => {
  const actual =
    await vi.importActual<typeof import("@opencircuit/fetch")>(
      "@opencircuit/fetch",
    );
  return {
    ...actual,
    fetchwithRequestOptions: vi.fn(),
  };
});

describe("customFetch", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  test("removes the OpenAI bearer header when api-key is configured", async () => {
    const requestOptions = {
      headers: {
        "api-key": "test-cisco-access-token",
        Accept: "application/json",
      },
      extraBodyProperties: {
        user: '{"appkey":"test-cisco-app-key"}',
        stop: ["<|im_end|>"],
      },
    };
    vi.mocked(fetchwithRequestOptions).mockResolvedValue({} as any);

    await customFetch(requestOptions)("https://example.test/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-cisco-access-token",
        "Content-Type": "application/json",
      },
    });

    const [url, , forwardedRequestOptions] = vi.mocked(fetchwithRequestOptions)
      .mock.calls[0];
    expect(url).toBe("https://example.test/chat/completions");
    expect(forwardedRequestOptions).toEqual(requestOptions);

    const [, init] = vi.mocked(fetchwithRequestOptions).mock.calls[0];
    const headers = new Headers(init?.headers as any);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("content-type")).toBe("application/json");
  });
});
