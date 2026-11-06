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
