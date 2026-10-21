/** Validate an IANA timezone name, falling back to UTC. */
export function resolveTz(h: unknown): string {
  const tz = typeof h === "string" && h ? h : "UTC";
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return "UTC"; }
}
/** YYYY-MM-DD in the given timezone (en-CA formats dates as ISO). */
export const localDate = (d: Date, tz: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
