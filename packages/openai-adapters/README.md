# `@opencircuit/openai-adapters`

This package contains provider-specific request and response adapters used by
Open Circuit's model runtime. Adapter code lives under `src/apis/`; shared
translation helpers live under `src/util/`.

Keep provider-independent model metadata in `@opencircuit/llm-info` where
appropriate. Adapter code should focus on the wire-format differences and
behavior that cannot be inferred by the caller, such as provider-specific
request fields and response normalization. Avoid treating this README as a
complete provider-support matrix: model capabilities and supported endpoints
vary by API and are represented in code and tests.

When changing an adapter, add or update focused tests for request mapping,
response handling, and streaming where applicable.

## Development

From this package directory:

```bash
npm run build
npm test -- --run
```
