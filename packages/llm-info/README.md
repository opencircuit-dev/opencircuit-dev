# `@opencircuit/llm-info`

This package provides model metadata grouped by provider. It is used to
identify model capabilities and recommendations; request translation and
transport belong to the adapter/runtime layers.

The `LlmInfo` type describes model identifiers, context and completion
limits, supported media, recommendations, and provider-specific parameters.
Each provider module exports a `ModelProvider` containing its model entries.
The current provider registry is assembled in `src/index.ts`.

## Public helpers

- `allModelProviders` lists registered providers.
- `allLlms` flattens provider model metadata and retains the provider ID.
- `findLlmInfo(model, preferProviderId?)` resolves model metadata, optionally
  preferring one provider.
- `getAllRecommendedFor(useCase)` selects models recommended for `chat`,
  `autocomplete`, `rerank`, or `embed`.

When adding or changing a model, update the appropriate provider definition
and add focused coverage where the consuming runtime relies on the metadata.
Build with `npm run build` from this package directory.
