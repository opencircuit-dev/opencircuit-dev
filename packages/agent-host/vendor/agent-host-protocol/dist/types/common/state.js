// Generated from types/*.ts — do not edit.
// Regenerate with: npm run generate:typescript
/**
 * How the server resumes sending data on a windowed subscription after
 * reconnection.
 *
 * @category Common Types
 * @stability 1.0
 * @exhaustive
 * @see {@link /specification/windowed-delivery#reconnection | Windowed Delivery: Reconnection}
 */
export var ChannelRecoveryKind;
(function (ChannelRecoveryKind) {
  /** The server sends a new `channel/snapshot`, and the client replaces its state. */
  ChannelRecoveryKind["Snapshot"] = "snapshot";
  /** The server sends again each action with a `serverSeq` greater than `lastAppliedServerSeq`. */
  ChannelRecoveryKind["Replay"] = "replay";
  /** The server sends only data created after reconnection. */
  ChannelRecoveryKind["Live"] = "live";
})(ChannelRecoveryKind || (ChannelRecoveryKind = {}));
