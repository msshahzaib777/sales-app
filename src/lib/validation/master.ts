import { z } from "zod";

import { PACKETS_PER_DOZEN, PACKETS_PER_HALF_DOZEN } from "@/lib/units";

// Master data validation, shared by forms, server actions and the Excel/CSV import.
// Form values arrive as strings; these schemas trim them, turn "" into null, and convert money to
// exact decimal strings and dozens to integer packets (CLAUDE.md rules 4 and 5).

const MONEY_PATTERN = /^-?\d{1,12}(\.\d{1,2})?$/;

/** "" | undefined → undefined; trims strings; removes thousands separators in numbers. */
export const blankToUndefined = (value: unknown) => {
  if (value === null || value === undefined) return undefined;
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const numberText = (value: unknown) => {
  const v = blankToUndefined(value);
  return typeof v === "string" ? v.replace(/,/g, "") : v;
};

export const requiredText = (label: string, max = 120) =>
  z.preprocess(
    blankToUndefined,
    z.string({ error: `Enter the ${label}` }).max(max, `Use at most ${max} characters`),
  );

export const optionalText = (max = 200) =>
  z
    .preprocess(blankToUndefined, z.string().max(max, `Use at most ${max} characters`).optional())
    .transform((v) => v ?? null);

export const phoneSchema = z
  .preprocess(
    blankToUndefined,
    z
      .string()
      .regex(/^[+\d][\d\s-]{6,19}$/, "Enter a valid phone number")
      .optional(),
  )
  .transform((v) => v ?? null);

/** Non-negative PKR amount as an exact decimal string, e.g. "1250.50". */
export const moneySchema = (label: string) =>
  z.preprocess(
    numberText,
    z
      .string({ error: `Enter the ${label}` })
      .regex(MONEY_PATTERN, `Enter the ${label} in rupees, with at most 2 decimals`)
      .refine((v) => !v.startsWith("-"), `The ${label} cannot be negative`),
  );

export const optionalMoneySchema = (label: string) =>
  z
    .preprocess(
      numberText,
      z
        .string()
        .regex(MONEY_PATTERN, `Enter the ${label} in rupees, with at most 2 decimals`)
        .refine((v) => !v.startsWith("-"), `The ${label} cannot be negative`)
        .optional(),
    )
    .transform((v) => v ?? null);

/** Signed amount (opening balances can be negative, e.g. an advance). Blank = 0. */
export const signedMoneySchema = (label: string) =>
  z
    .preprocess(
      numberText,
      z
        .string()
        .regex(MONEY_PATTERN, `Enter the ${label} in rupees, with at most 2 decimals`)
        .optional(),
    )
    .transform((v) => v ?? "0");

/**
 * Dozens as typed (whole or .5) → integer packets. `min` is in dozens (e.g. 0.5 = at least half a
 * dozen).
 */
export const dozensSchema = (label: string, { min = 0 } = {}) =>
  z.preprocess(
    numberText,
    z
      .string({ error: `Enter the ${label}` })
      .regex(/^\d{1,7}(\.\d+)?$/, `Enter the ${label} in dozens`)
      .refine(
        (v) => Number.isInteger(Number(v) * 2),
        `The ${label} must be in whole or half dozens`,
      )
      .transform((v) => (Number(v) * 2 * PACKETS_PER_HALF_DOZEN) as number)
      .refine(
        (packets) => packets >= min * PACKETS_PER_DOZEN,
        `The ${label} must be at least ${min} dozen`,
      ),
  );

/** Packets as typed (a whole number; 12 packets = 1 dozen): damage and returns. */
export const packetsSchema = (label: string, { min = 0 } = {}) =>
  z.preprocess(
    numberText,
    z.coerce
      .number({ error: `Enter the ${label} in packets` })
      .int(`The ${label} must be a whole number of packets`)
      .min(min, min > 0 ? `Enter the ${label} in packets` : `The ${label} cannot be negative`)
      .max(9_999_999, `The ${label} is too large`),
  );

const intSchema = (label: string, min: number, max: number) =>
  z.preprocess(
    numberText,
    z.coerce
      .number({ error: `Enter the ${label}` })
      .int(`The ${label} must be a whole number`)
      .min(min, `The ${label} must be at least ${min}`)
      .max(max, `The ${label} must be at most ${max}`),
  );

const optionalIntSchema = (label: string, min: number, max: number) =>
  z.preprocess(numberText, intSchema(label, min, max).optional()).transform((v) => v ?? null);

/** A blank form field (or a missing value) means `fallback`. */
export function blankAs<T extends z.ZodType>(schema: T, fallback: z.output<T>) {
  return z
    .preprocess(blankToUndefined, schema.optional())
    .transform((v) => (v ?? fallback) as z.output<T>);
}

export const idSchema = z.string().min(1).max(40);
const optionalIdSchema = z
  .preprocess(blankToUndefined, idSchema.optional())
  .transform((v) => v ?? null);

/** Business date from a date input ("2026-10-24") → Date at UTC midnight (stored as @db.Date). */
export const dateSchema = (label: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .string({ error: `Enter the ${label}` })
      .regex(/^\d{4}-\d{2}-\d{2}$/, `Enter the ${label} as a date`)
      .transform((v) => new Date(`${v}T00:00:00.000Z`))
      .refine((d) => !Number.isNaN(d.getTime()), `Enter a valid ${label}`),
  );

export const optionalDateSchema = (label: string) =>
  z.preprocess(blankToUndefined, dateSchema(label).optional()).transform((v) => v ?? null);

export const requestIdSchema = z.preprocess(blankToUndefined, z.uuid().optional());

// ───────────────────────── Records ─────────────────────────

export const warehouseSchema = z.object({
  requestId: requestIdSchema,
  name: requiredText("warehouse name", 80),
  address: optionalText(200),
});

export const areaSchema = z.object({
  requestId: requestIdSchema,
  warehouseId: idSchema,
  name: requiredText("area name", 80),
  sortOrder: blankAs(intSchema("visiting order", 0, 9999), 0),
});

export const companySchema = z.object({
  requestId: requestIdSchema,
  warehouseId: idSchema,
  name: requiredText("company name", 120),
  contactName: optionalText(80),
  phone: phoneSchema,
  address: optionalText(200),
  orderBookerName: optionalText(80),
  orderBookerPhone: phoneSchema,
  paymentTermsDays: intSchema("payment terms", 0, 365),
  /** What we owe the company at the start (negative if they owe us). */
  openingBalance: signedMoneySchema("opening balance"),
});

export const DISCOUNT_TYPES = ["NONE", "AMOUNT_PER_UNIT", "PERCENT"] as const;

export const discountSlabSchema = z.object({
  fromDozens: dozensSchema("slab quantity", { min: 0.5 }),
  value: moneySchema("slab discount"),
});

export const productSchema = z
  .object({
    requestId: requestIdSchema,
    companyId: idSchema,
    code: z.preprocess(
      (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
      z
        .string({ error: "Enter a short code" })
        .min(1, "Enter a short code")
        .max(12, "Use at most 12 characters")
        .regex(/^[A-Z0-9-]+$/, "Use letters, numbers and dashes only"),
    ),
    name: requiredText("product name", 120),
    purchaseRate: moneySchema("purchase rate"),
    saleRate: moneySchema("sale rate"),
    discountType: blankAs(z.enum(DISCOUNT_TYPES), "NONE"),
    discountValue: blankAs(moneySchema("discount"), "0"),
    /** Quantity slabs: from N dozen, this discount replaces the base one (same unit as the base). */
    slabs: z.array(discountSlabSchema).max(10, "Use at most 10 slabs").default([]),
    minStockLevel: blankAs(dozensSchema("minimum stock"), 0),
    /** When new rates take effect (price history). */
    effectiveFrom: dateSchema("effective date"),
  })
  .superRefine((p, ctx) => {
    if (p.discountType === "PERCENT") {
      if (Number(p.discountValue) > 100)
        ctx.addIssue({
          code: "custom",
          path: ["discountValue"],
          message: "A percent discount cannot be more than 100",
        });
      p.slabs.forEach((s, i) => {
        if (Number(s.value) > 100)
          ctx.addIssue({
            code: "custom",
            path: ["slabs", i, "value"],
            message: "A percent discount cannot be more than 100",
          });
      });
    }
    if (p.discountType === "NONE" && Number(p.discountValue) !== 0) {
      ctx.addIssue({ code: "custom", path: ["discountType"], message: "Choose a discount type" });
    }
    const seen = new Set<number>();
    p.slabs.forEach((s, i) => {
      if (seen.has(s.fromDozens))
        ctx.addIssue({
          code: "custom",
          path: ["slabs", i, "fromDozens"],
          message: "Two slabs start at the same quantity",
        });
      seen.add(s.fromDozens);
    });
  })
  // A zero discount without slabs is simply "no discount".
  .transform((p) =>
    p.discountType !== "NONE" && Number(p.discountValue) === 0 && p.slabs.length === 0
      ? { ...p, discountType: "NONE" as const }
      : p,
  );

export const CUSTOMER_TYPES = ["RETAILER", "WHOLESALER", "DEALER", "BIKE_SUPPLIER"] as const;

export const customerSchema = z.object({
  requestId: requestIdSchema,
  name: requiredText("customer name", 120),
  shopName: optionalText(120),
  type: z.enum(CUSTOMER_TYPES, { error: "Choose a customer type" }),
  phone: phoneSchema,
  whatsapp: phoneSchema,
  address: optionalText(200),
  areaId: optionalIdSchema,
  routeSequence: optionalIntSchema("visiting order", 0, 9999),
  /** Blank = no limit. */
  creditLimit: optionalMoneySchema("credit limit"),
  /** companyId → what the customer owes for that company at the start (negative = advance). */
  openingBalances: z.record(idSchema, signedMoneySchema("opening balance")).default({}),
});

export const bikeSchema = z.object({
  requestId: requestIdSchema,
  name: requiredText("bike name or number", 60),
  warehouseId: optionalIdSchema,
  capacity: dozensSchema("capacity", { min: 1 }),
  driverId: optionalIdSchema,
});

export const STAFF_ROLES = ["DRIVER", "OFFICE", "LOADER", "OTHER"] as const;

export const staffSchema = z.object({
  requestId: requestIdSchema,
  name: requiredText("name", 80),
  role: z.enum(STAFF_ROLES, { error: "Choose a role" }),
  phone: phoneSchema,
  monthlySalary: moneySchema("monthly salary"),
  joiningDate: optionalDateSchema("joining date"),
});

export const recordIdSchema = z.object({ id: idSchema });

export type WarehouseInput = z.infer<typeof warehouseSchema>;
export type AreaInput = z.infer<typeof areaSchema>;
export type CompanyInput = z.infer<typeof companySchema>;
export type ProductInput = z.infer<typeof productSchema>;
export type CustomerInput = z.infer<typeof customerSchema>;
export type BikeInput = z.infer<typeof bikeSchema>;
export type StaffInput = z.infer<typeof staffSchema>;
