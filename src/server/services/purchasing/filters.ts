import { z } from "zod";

// Date-range and paging filters for purchasing lists and the ledger (?from=…&to=…&page=…).

export type DateRange = { from?: Date; to?: Date };

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
const dateParam = z.preprocess(
  first,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .transform((v) => new Date(`${v}T00:00:00.000Z`))
    .optional(),
);

export const dateRangeSchema = z.object({
  from: dateParam.catch(undefined),
  to: dateParam.catch(undefined),
});

export function parseDateRange(params: Record<string, unknown>): DateRange {
  const range = dateRangeSchema.parse(params);
  // Swap a reversed range rather than showing nothing.
  if (range.from && range.to && range.from > range.to) return { from: range.to, to: range.from };
  return range;
}

/** Ledger default: from the 1st of last month to today (business dates). */
export function defaultLedgerRange(today: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  return { from, to: today };
}
