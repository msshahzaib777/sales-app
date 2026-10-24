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
