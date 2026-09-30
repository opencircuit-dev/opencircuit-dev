# `core` rules

Whenever a new protocol message is added to the `protocol/` directory, check the following:

- It's type is defined correctly
- If it is a message from webview to core or vice versa:
  - It has been added to `core/protocol/passThrough.ts`
- It is implemented in either `core/core.ts` (for messages to the core), in a `useWebviewListener` (for messages to the GUI), or in the owning host messenger for messages to the IDE.
- It does not duplicate functionality from another message type that already exists.
