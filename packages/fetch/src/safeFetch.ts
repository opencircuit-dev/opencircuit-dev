import type { RequestInit, Response } from "node-fetch";
import { fetchwithRequestOptions } from "./fetch.js";
import { RequestOptions } from "@opencircuit/config-types";
import { resolveNetworkDestination } from "./ssrfPolicy.js";

const SAFE_FETCH_TIMEOUT_SECONDS = 15;
const SAFE_FETCH_MAX_RESPONSE_BYTES = 1_000_000;

export async function fetchUntrustedUrl(
  input: URL | string,
  init: RequestInit = {},
  requestOptions?: RequestOptions,
): Promise<Response> {
  const url = new URL(input);
  const destination = await resolveNetworkDestination(url, requestOptions);
  const timeout = Math.min(
    Math.max(requestOptions?.timeout ?? SAFE_FETCH_TIMEOUT_SECONDS, 0.1),
    SAFE_FETCH_TIMEOUT_SECONDS,
  );

  return fetchwithRequestOptions(
    url,
    {
      ...init,
      redirect: "manual",
      size: SAFE_FETCH_MAX_RESPONSE_BYTES,
    },
    {
      timeout,
      verifySsl: true,
      localUrlOrigins: requestOptions?.localUrlOrigins,
    },
    destination,
  );
}
