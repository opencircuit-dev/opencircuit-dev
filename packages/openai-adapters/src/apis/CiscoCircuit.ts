import { OpenAI } from "openai/index";
import type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  Completion,
  CompletionCreateParamsNonStreaming,
  CompletionCreateParamsStreaming,
  CreateEmbeddingResponse,
  EmbeddingCreateParams,
  Model,
} from "openai/resources/index";

import type {
  BaseLlmApi,
  CreateRerankResponse,
  FimCreateParamsStreaming,
  RerankCreateParams,
} from "./base.js";

const APPROVED_GATEWAY_ORIGIN = "https://organon.cisco.com";
const ROUTE_PREFIX = "/vscode-plugin/api/llm/openai/deployments/";

export const CISCO_CIRCUIT_GATEWAY_ORIGIN = APPROVED_GATEWAY_ORIGIN;
export const CISCO_CIRCUIT_ROUTE_PREFIX = ROUTE_PREFIX;

/** Dedicated adapter for the protected Cisco Circuit gateway contract. */
export class CiscoCircuitApi implements BaseLlmApi {
  private readonly client: OpenAI;
  private readonly approvedBase: URL;

  constructor(
    apiBase: string,
    private readonly accessToken: () => Promise<string | null>,
    private readonly apiVersion: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.approvedBase = validateCircuitEndpoint(apiBase);
    this.client = new OpenAI({
      // The transport replaces this SDK placeholder before every request.
      apiKey: "cisco-circuit-transport",
      baseURL: this.approvedBase.toString(),
      fetch: this.authenticatedFetch.bind(this),
    });
  }

  async chatCompletionNonStream(
    body: ChatCompletionCreateParamsNonStreaming,
    signal: AbortSignal,
  ): Promise<ChatCompletion> {
    await this.requireAccessToken(signal);
    return this.client.chat.completions.create(body, { signal });
  }

  async *chatCompletionStream(
    body: ChatCompletionCreateParamsStreaming,
    signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk> {
    await this.requireAccessToken(signal);
    const response = await this.client.chat.completions.create(body, {
      signal,
    });
    for await (const chunk of response) yield chunk;
  }

  async completionNonStream(
    _body: CompletionCreateParamsNonStreaming,
    _signal: AbortSignal,
  ): Promise<Completion> {
    throw unsupportedOperation();
  }

  async *completionStream(
    _body: CompletionCreateParamsStreaming,
    _signal: AbortSignal,
  ): AsyncGenerator<Completion> {
    throw unsupportedOperation();
  }

  async *fimStream(
    _body: FimCreateParamsStreaming,
    _signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk> {
    throw unsupportedOperation();
  }

  async embed(_body: EmbeddingCreateParams): Promise<CreateEmbeddingResponse> {
    throw unsupportedOperation();
  }

  async rerank(_body: RerankCreateParams): Promise<CreateRerankResponse> {
    throw unsupportedOperation();
  }

  async list(): Promise<Model[]> {
    throw unsupportedOperation();
  }

  private async authenticatedFetch(
    input: URL | string | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const requestUrl = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input
          : input.url,
    );
    if (
      requestUrl.origin !== APPROVED_GATEWAY_ORIGIN ||
      !requestUrl.pathname.startsWith(ROUTE_PREFIX)
    ) {
      throw new Error(
        "Cisco Circuit request escaped the approved gateway route",
      );
    }
    if (requestUrl.pathname.endsWith("/chat/completions")) {
      requestUrl.searchParams.set("api-version", this.apiVersion);
    }

    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const token = await this.requireAccessToken(signal);

    const headers = new Headers(init?.headers);
    headers.delete("api-key");
    headers.delete("x-api-key");
    headers.set("Authorization", `Bearer ${token}`);
    return this.fetchImpl(requestUrl, { ...init, headers });
  }

  private async requireAccessToken(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    let token: string | null;
    if (signal) {
      let onAbort!: () => void;
      const cancelled = new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      });
      try {
        token = await Promise.race([this.accessToken(), cancelled]);
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
      signal.throwIfAborted();
    } else {
      token = await this.accessToken();
    }
    if (!token) throw new Error("Cisco Circuit authentication is required");
    return token;
  }
}

function validateCircuitEndpoint(value: string): URL {
  const endpoint = new URL(value);
  if (
    endpoint.origin !== APPROVED_GATEWAY_ORIGIN ||
    endpoint.protocol !== "https:" ||
    !endpoint.pathname.startsWith(ROUTE_PREFIX) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("Cisco Circuit gateway endpoint is not approved");
  }
  return endpoint;
}

function unsupportedOperation(): Error {
  return new Error("Cisco Circuit gateway only supports chat completions");
}
