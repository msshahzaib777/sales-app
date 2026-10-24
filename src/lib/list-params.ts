import { z } from "zod";

// Query-string filters shared by master-data lists (?q=…&status=…&page=…).

export const STATUS_FILTERS = ["active", "inactive", "all"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);

export const listParamsSchema = z.object({
  q: z.preprocess(first, z.string().trim().max(100).optional()).catch(undefined),
  status: z.preprocess(first, z.enum(STATUS_FILTERS)).catch("active"),
  page: z.preprocess(first, z.coerce.number().int().min(1).max(10_000)).catch(1),
});

export type ListParams = z.infer<typeof listParamsSchema>;

/** Extra single-value filters, e.g. ?companyId=…; invalid or blank values are ignored. */
export function filterParam(params: Record<string, unknown>, key: string): string | undefined {
  const v = first(params[key]);
  return typeof v === "string" && v.trim() !== "" && v.length <= 40 ? v.trim() : undefined;
}

export function statusWhere(status: StatusFilter) {
  return status === "all" ? {} : { isActive: status === "active" };
}

/** The words of a search box, e.g. "  kh  ali " → ["kh", "ali"] (at most 6). */
export function searchWords(q: string | undefined): string[] {
  return (q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 6);
}

/** Case-insensitive "contains" for one word. */
export const icontains = (word: string) => ({ contains: word, mode: "insensitive" as const });

/**
 * Every word must match at least one of the conditions `match(word)` gives, in any order and in
 * any of the fields: "kh ali" finds "Ali Khan", "ali kiryana" finds Ali at Mughal Kiryana Store.
 */
export function matchEveryWord<T>(q: string | undefined, match: (word: string) => T[]) {
  const words = searchWords(q);
  return words.length ? { AND: words.map((w) => ({ OR: match(w) })) } : {};
}

/** "12" or "#12" → 12, for finding a document by its number; otherwise undefined. */
export function searchNumber(q: string | undefined): number | undefined {
  const m = (q ?? "").trim().match(/^#?(\d{1,9})$/);
  return m ? Number(m[1]) : undefined;
}

/** Every word in at least one of several text columns (see matchEveryWord). */
export function searchWhere(q: string | undefined, fields: string[]) {
  return matchEveryWord(q, (w) => fields.map((field) => ({ [field]: icontains(w) })));
}
