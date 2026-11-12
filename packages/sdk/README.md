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

The public SDK currently has no OAuth/OIDC manager or built-in persistent OS
token store. Windows support for a built-in token store is deferred
indefinitely.

The `@opencircuit/sdk/ahp` entry point provides a thin wrapper around the
official AHP TypeScript client and an Open Circuit stdio transport:

```ts
import { spawnStdioAhpClient } from "@opencircuit/sdk/ahp";

const connection = spawnStdioAhpClient({
  command: "oc",
  args: ["agent", "host"],
});
await connection.client.initialize({
  clientId: "example-client",
  protocolVersions: ["1.1.0", "1.0.0"],
  initialSubscriptions: ["ahp-root://"],
});
```

The AHP layer is separate from the REST client. It uses four-byte big-endian
length-prefixed JSON frames over stdio and does not carry provider credentials.

## Development

From this package directory:

```bash
npm run build
npm test
```
