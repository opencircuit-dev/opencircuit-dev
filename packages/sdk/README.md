# `@opencircuit/sdk`

First-party Node.js client for the Open Circuit API. The client can retrieve
and list assistants and synchronize secrets:

```ts
import { OpenCircuitClient } from "@opencircuit/sdk";

const client = new OpenCircuitClient({
  baseUrl: process.env.OCIRCUIT_API_BASE ?? "https://api.ocircuit.dev/",
  accessToken: process.env.OCIRCUIT_API_KEY,
});

const assistant = await client.getAssistant({
  ownerSlug: "opencircuit-dev",
  packageSlug: "default-cli-config",
});

const assistants = await client.listAssistants();
```

The initial API surface supports assistant lookup/listing and secret synchronization. Requests use the configured API base and send the API key only as a bearer authorization header.

## OAuth/OIDC authentication

`AuthManager` accepts the strict `auth` configuration from
`@opencircuit/config-types`. Enabled configurations must provide an OIDC issuer
or both explicit OAuth authorization and token endpoints, plus a client ID.
The flow uses an ephemeral `127.0.0.1` callback, S256 PKCE, state, nonce,
exact redirect-path checks, form-encoded code exchange, issuer/JWKS/ID-token
validation, expiry-aware refresh, and revocation when supported by the
provider.

Tokens are held in memory by default. Applications that need persistence must
inject a `SecureTokenStore` implemented with the platform OS keychain. The SDK
does not write OAuth tokens to YAML, `.env`, logs, or an unencrypted file.

Use `syncSecrets()` for secret synchronization. Requests use the configured
API base (default `https://api.ocircuit.dev/`); when an access token is
provided, the client sends it as a bearer authorization header. Non-success
HTTP responses reject with `OpenCircuitApiError`.

## Development

From this package directory:

```bash
npm run build
npm test
```
