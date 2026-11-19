# `@opencircuit/agent-host`

The Open Circuit Agent Host Protocol (AHP) host. The package currently
provides the required JSON-RPC 2.0 stdio transport, the pinned AHP 1.1.0 draft
handshake, Core-owned session-store adapter, and deterministic protocol tests.

The pinned upstream client is built from
`microsoft/agent-host-protocol@a768e7444261f27748d29847cebefc61d2c5dcf1`.
See `vendor/agent-host-protocol/PROVENANCE.md` in the repository for the
build and integrity record.

WebSocket transport, turns/tools, reconnect replay, and remote endpoint
management remain separate follow-up qualification stages. The host never
claims those surfaces until their tests are present.
