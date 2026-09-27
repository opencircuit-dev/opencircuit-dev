export interface OpenCircuitClientOptions {
  baseUrl?: string;
  accessToken?: string | null;
  fetch?: typeof fetch;
}

export interface AssistantConfigResult<TConfig = unknown> {
  config: TConfig | null;
  configLoadInterrupted?: boolean;
  errors?: Array<{ fatal?: boolean; message: string }> | string[] | null;
}

export interface AssistantRecord<TConfig = unknown> {
  ownerSlug: string;
  packageSlug: string;
  configResult: AssistantConfigResult<TConfig>;
  iconUrl?: string | null;
  onPremProxyUrl?: string | null;
  useOnPremProxy?: boolean | null;
  rawYaml?: string;
}

export interface AssistantQueryOptions {
  alwaysUseProxy?: "true" | "false";
  organizationId?: string;
}

export interface GetAssistantOptions extends AssistantQueryOptions {
  ownerSlug: string;
  packageSlug: string;
}

export interface SyncSecretsRequest {
  fqsns: Array<{
    packageSlugs: Array<{ ownerSlug: string; packageSlug: string }>;
    secretName: string;
  }>;
  orgScopeId?: string | null;
  orgScopeSlug?: string | null;
}

export interface SecretSyncResult {
  found: boolean;
  fqsn?: SyncSecretsRequest["fqsns"][number];
  value?: string;
  secretLocation?: {
    secretName: string;
    secretType: string;
  };
}

export class OpenCircuitApiError extends Error {
  constructor(
    readonly status: number,
    readonly statusText: string,
    readonly responseBody: string,
  ) {
    super(
      responseBody
        ? `Open Circuit API request failed: ${status} ${statusText} - ${responseBody}`
        : `Open Circuit API request failed: ${status} ${statusText}`,
    );
    this.name = "OpenCircuitApiError";
  }
}

export class OpenCircuitClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenCircuitClientOptions = {}) {
    this.baseUrl = `${(options.baseUrl ?? "https://api.ocircuit.dev/").replace(/\/+$/, "")}/`;
    this.fetchImpl = options.fetch ?? fetch;
  }

  get isAuthenticated(): boolean {
    return Boolean(this.options.accessToken);
  }

  getAssistant<TConfig = unknown>(
    options: GetAssistantOptions,
  ): Promise<AssistantRecord<TConfig>> {
    const { ownerSlug, packageSlug, ...query } = options;
    const path = `ide/get-assistant/${encodeURIComponent(ownerSlug)}/${encodeURIComponent(packageSlug)}`;
    return this.request<AssistantRecord<TConfig>>(path, { query });
  }

  listAssistants<TConfig = unknown>(
    options: AssistantQueryOptions = {},
  ): Promise<AssistantRecord<TConfig>[]> {
    return this.request<AssistantRecord<TConfig>[]>("ide/list-assistants", {
      query: { ...options },
    });
  }

  syncSecrets(options: {
    syncSecretsRequest: SyncSecretsRequest;
  }): Promise<Array<SecretSyncResult | null>> {
    return this.request<Array<SecretSyncResult | null>>("ide/sync-secrets", {
      method: "POST",
      body: options.syncSecretsRequest,
    });
  }

  private async request<T>(
    path: string,
    options: {
      query?: Record<string, string | undefined>;
      method?: "GET" | "POST";
      body?: unknown;
    } = {},
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, value);
      }
    }

    const headers = new Headers({ Accept: "application/json" });
    if (this.options.accessToken) {
      headers.set("Authorization", `Bearer ${this.options.accessToken}`);
    }
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    const response = await this.fetchImpl(url, {
      method: options.method ?? "GET",
      headers,
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (!response.ok) {
      throw new OpenCircuitApiError(
        response.status,
        response.statusText,
        await response.text(),
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }
}
