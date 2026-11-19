/**
 * Notification methods that do not count against the window on a windowed
 * subscription. Every other notification for a subscription counts.
 *
 * @see {@link /specification/windowed-delivery#control-messages | Windowed Delivery: Control Messages}
 */
export declare const WINDOW_EXEMPT_METHODS: readonly [
  "channel/credit",
  "tcp/reset",
  "unsubscribe",
];
/** A notification method that does not count against the window. */
export type WindowExemptMethod = (typeof WINDOW_EXEMPT_METHODS)[number];
/**
 * Whether a notification with this method counts against the window on a
 * windowed subscription. Methods that are not recognized count.
 */
export declare function countsAgainstWindow(method: string): boolean;
//# sourceMappingURL=window-exempt.generated.d.ts.map
