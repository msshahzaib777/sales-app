// Business analysis helpers (Reports → Business analysis), shared by the server and the page. Pure.
//
// Periods are business dates (UTC midnight), inclusive: weeks run Monday to Sunday, months and
// quarters are calendar ones.

export const PERIOD_KINDS = ["week", "month", "quarter"] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

export const PERIOD_KIND_LABEL: Record<PeriodKind, string> = {
  week: "Week",
  month: "Month",
  quarter: "Quarter",
};

/** How many periods the trend chart shows. */
export const TREND_LENGTH: Record<PeriodKind, number> = { week: 12, month: 12, quarter: 8 };

const DAY_MS = 86_400_000;
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

export type PeriodRange = { from: Date; to: Date };

/** The week, month or quarter that contains `date`. */
export function periodOf(kind: PeriodKind, date: Date): PeriodRange {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  if (kind === "week") {
    const monday = new Date(date.getTime() - ((date.getUTCDay() + 6) % 7) * DAY_MS);
    return { from: monday, to: new Date(monday.getTime() + 6 * DAY_MS) };
  }
  const first = kind === "month" ? m : m - (m % 3);
  const months = kind === "month" ? 1 : 3;
  return { from: utc(y, first, 1), to: utc(y, first + months, 0) };
}

/** The period `steps` periods after (negative: before) the one containing `date`. */
export function shiftPeriod(kind: PeriodKind, date: Date, steps: number): PeriodRange {
  const { from } = periodOf(kind, date);
  if (kind === "week") return periodOf(kind, new Date(from.getTime() + steps * 7 * DAY_MS));
  const months = kind === "month" ? steps : steps * 3;
  return periodOf(kind, utc(from.getUTCFullYear(), from.getUTCMonth() + months, 1));
}

// Spelled out, not Intl: Node's month abbreviations differ between systems ("Sep" / "Sept").
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Short name for a period, e.g. "Oct 2026", "Q4 2026", "Week of 19 Oct". */
export function periodLabel(kind: PeriodKind, range: PeriodRange): string {
  const y = range.from.getUTCFullYear();
  const month = MONTHS[range.from.getUTCMonth()]!;
  if (kind === "quarter") return `Q${Math.floor(range.from.getUTCMonth() / 3) + 1} ${y}`;
  if (kind === "month") return `${month} ${y}`;
  return `Week of ${range.from.getUTCDate()} ${month}`;
}

/** Change from `previous` to `current` in %, or null when there was nothing before. */
export function changePct(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/** A change of this many % or more (either way) counts as rising or declining. */
export const TREND_THRESHOLD = 20;

export type Trend = "NEW" | "STOPPED" | "RISING" | "DECLINING" | "STEADY" | "NONE";

/** Rising, declining, new, stopped or steady, from this period's and the previous one's figure. */
export function trendOf(current: number, previous: number): Trend {
  if (current <= 0 && previous <= 0) return "NONE";
  if (previous <= 0) return "NEW";
  if (current <= 0) return "STOPPED";
  const pct = changePct(current, previous)!;
  if (pct >= TREND_THRESHOLD) return "RISING";
  if (pct <= -TREND_THRESHOLD) return "DECLINING";
  return "STEADY";
}

/** A customer counts as paying late past this many days. */
export const LATE_DAYS = 30;

/** Whole days from `from` to `to` (business dates). */
export const daysBetween = (from: Date, to: Date) =>
  Math.round((to.getTime() - from.getTime()) / DAY_MS);
