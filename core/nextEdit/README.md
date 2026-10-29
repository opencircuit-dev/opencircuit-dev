# Core next-edit prediction

This directory contains Core's next-edit prediction support. It is an
implementation module, not a user setup guide for the retired standalone
VS Code extension.

## Code map

- `NextEditProvider` and `providers/` implement provider selection and
  provider-specific requests.
- `context/` prepares edit history and prompt context.
- `templating/` builds provider prompts.
- `diff/` and `NextEditEditableRegionCalculator.ts` handle predicted edits
  and editable regions.
- `DocumentHistoryTracker.ts` and the adjacent `*.vitest.ts` files cover
  history, prompt, and diff behavior.

When changing this subsystem, keep provider input/output types aligned in
`types.ts` and add focused tests for the affected context, prompt, or diff
behavior.
