/**
 * Compact relative-time formatter for note metadata.
 *
 * Produces strings like:
 *   "just now"
 *   "5m ago"
 *   "3h ago"
 *   "Yesterday"
 *   "3d ago"
 *   "Mar 14"
 *   "Mar 14, 2023"
 *
 * The "now" reference is provided by the caller to keep tests deterministic
 * and to prevent the user-supplied client clock from affecting the saved
 * timestamp (the timestamp itself comes from the server).
 */

const SHORT_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const LONG_DATE = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function startOfDay(d: Date): number {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";

  const diff = Math.max(0, now.getTime() - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "just now";

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;

  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;

  // Cross-day boundary: show "Yesterday" when the date is exactly one
  // calendar day before `now` in the local timezone.
  const daysAgo = Math.floor((startOfDay(now) - startOfDay(new Date(t))) / 86_400_000);
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo < 7) return `${daysAgo}d ago`;

  // Older: render a short date, with the year only when it differs.
  const d = new Date(t);
  return d.getFullYear() === now.getFullYear()
    ? SHORT_DATE.format(d)
    : LONG_DATE.format(d);
}

export function formatFullDate(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  return d.getFullYear() === now.getFullYear()
    ? SHORT_DATE.format(d)
    : LONG_DATE.format(d);
}
