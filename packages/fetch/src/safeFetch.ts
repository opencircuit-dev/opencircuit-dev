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
  if (
    requestOptions?.timeout !== undefined &&
    (!Number.isFinite(requestOptions.timeout) || requestOptions.timeout <= 0)
  ) {
    throw new Error("URL fetch timeout must be finite and positive");
  }
  const timeout = Math.min(
    Math.max(requestOptions?.timeout ?? SAFE_FETCH_TIMEOUT_SECONDS, 0.1),
    SAFE_FETCH_TIMEOUT_SECONDS,
  );

  const controller = new AbortController();
  const deadline = AbortSignal.timeout(Math.ceil(timeout * 1000));
  const abort = () => controller.abort();
  deadline.addEventListener("abort", abort, { once: true });
  init.signal?.addEventListener("abort", abort);
  if (init.signal?.aborted) controller.abort();
  const cleanup = () => {
    deadline.removeEventListener("abort", abort);
    init.signal?.removeEventListener("abort", abort);
  };
  let rejectResolution: () => void = () => {};
  const resolutionTimeout = new Promise<never>((_resolve, reject) => {
    rejectResolution = () => reject(new Error("URL fetch timeout or abort"));
    controller.signal.addEventListener("abort", rejectResolution, {
      once: true,
    });
    if (controller.signal.aborted) rejectResolution();
  });
  try {
    const destination = await Promise.race([
      resolveNetworkDestination(url),
      resolutionTimeout,
    ]);
    controller.signal.removeEventListener("abort", rejectResolution);
    const response = await fetchwithRequestOptions(
      url,
      {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: controller.signal,
        redirect: "manual",
        size: SAFE_FETCH_MAX_RESPONSE_BYTES,
      },
      {
        timeout,
        verifySsl: true,
      },
      destination,
    );
    if (response.body) {
      response.body.once("close", cleanup);
      response.body.once("end", cleanup);
      response.body.once("error", cleanup);
    } else cleanup();
    return response;
  } catch (error) {
    controller.signal.removeEventListener("abort", rejectResolution);
    cleanup();
    throw error;
  }
}
