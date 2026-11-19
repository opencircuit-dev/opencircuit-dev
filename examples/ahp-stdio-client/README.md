# AHP stdio teaching client

This dependency-free client is the first transport smoke path. Build the CLI
first, then run it from the repository root:

```bash
node examples/ahp-stdio-client/client.mjs
```

It launches `oc agent host`, writes four-byte big-endian length-prefixed JSON
RPC messages, negotiates AHP 1.1.0, and lists the Core-owned sessions. It uses
no provider credentials and makes no model request.
