# @opencircuit/sdk

First-party Node.js client for the Open Circuit API.

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
```

The initial API surface supports assistant lookup/listing and secret synchronization. Requests use the configured API base and send the API key only as a bearer authorization header.
