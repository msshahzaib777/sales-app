const DEFAULT_TIME_ZONE = "Asia/Karachi";

/** Today's business date in the tenant's time zone, as a Date at UTC midnight (for @db.Date). */
export function businessToday(timeZone = DEFAULT_TIME_ZONE, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return new Date(`${parts}T00:00:00.000Z`);
}

/** A @db.Date value as "YYYY-MM-DD" for <input type="date">. */
export function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** A @db.Date value for display, e.g. "24 Oct 2026". */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export const PERIODS = {
  "this-week": "This week",
  "last-week": "Last week",
  "this-month": "This month",
  "last-month": "Last month",
} as const;
export type Period = keyof typeof PERIODS;

/** A report period as business dates (weeks start on Monday), from `today` (UTC midnight). */
export function periodRange(period: Period, today: Date): { from: Date; to: Date } {
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const day = (d: number) => new Date(Date.UTC(y, m, d));
  if (period === "this-month") return { from: day(1), to: new Date(Date.UTC(y, m + 1, 0)) };
  if (period === "last-month") return { from: new Date(Date.UTC(y, m - 1, 1)), to: day(0) };
  const sinceMonday = (today.getUTCDay() + 6) % 7;
  const monday = day(today.getUTCDate() - sinceMonday - (period === "last-week" ? 7 : 0));
  return { from: monday, to: new Date(monday.getTime() + 6 * 86_400_000) };
}
