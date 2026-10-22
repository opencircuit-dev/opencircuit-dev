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

/** Dedicated adapter for the protected Cisco Circuit gateway contract. */
export class CiscoCircuitApi implements BaseLlmApi {
  private readonly client: OpenAI;
  private readonly approvedBase: URL;

  constructor(
    apiBase: string,
    private readonly accessToken: () => Promise<string | null>,
    private readonly apiVersion: string,
  ) {
    this.approvedBase = validateCircuitEndpoint(apiBase);
    this.client = new OpenAI({
      apiKey: "",
      baseURL: this.approvedBase.toString(),
      fetch: this.authenticatedFetch.bind(this),
    });
  }

  async chatCompletionNonStream(
    body: ChatCompletionCreateParamsNonStreaming,
    signal: AbortSignal,
  ): Promise<ChatCompletion> {
    return this.client.chat.completions.create(body, { signal });
  }

  async *chatCompletionStream(
    body: ChatCompletionCreateParamsStreaming,
    signal: AbortSignal,
  ): AsyncGenerator<ChatCompletionChunk> {
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

    const token = await this.accessToken();
    if (!token) throw new Error("Cisco Circuit authentication is required");

    const headers = new Headers(init?.headers);
    headers.delete("api-key");
    headers.delete("x-api-key");
    headers.set("Authorization", `Bearer ${token}`);
    return fetch(requestUrl, { ...init, headers });
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
    endpoint.hash
  ) {
    throw new Error("Cisco Circuit gateway endpoint is not approved");
  }
  return endpoint;
}

function unsupportedOperation(): Error {
  return new Error("Cisco Circuit gateway only supports chat completions");
}
