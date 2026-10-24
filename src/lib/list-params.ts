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

/** Case-insensitive "contains" across several text columns. */
export function searchWhere(q: string | undefined, fields: string[]) {
  if (!q) return {};
  return {
    OR: fields.map((field) => ({ [field]: { contains: q, mode: "insensitive" as const } })),
  };
}
