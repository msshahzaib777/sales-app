import { z } from "zod";

import {
  blankToUndefined,
  dateSchema,
  idSchema,
  moneySchema,
  optionalText,
  requestIdSchema,
} from "./master";
import { PAYMENT_METHODS } from "./purchasing";

const optionalId = z.preprocess(blankToUndefined, idSchema.optional()).transform((v) => v ?? null);

/** Our own expense, or paid for a company that pays it back (deducted on its next bill). */
export const CHARGE_TO = ["OWN", "BOOKER_SALARY", "COMPANY_EXPENSE"] as const;
export type ChargeTo = (typeof CHARGE_TO)[number];

/** One expense (SPEC §9). Warehouse, bike, trip and staff are optional links for reports. */
export const expenseSchema = z
  .object({
    requestId: requestIdSchema,
    expenseDate: dateSchema("date"),
    chargeTo: z.preprocess(blankToUndefined, z.enum(CHARGE_TO).default("OWN")),
    /** The company that pays it back (booker salary, company expense). */
    companyId: optionalId,
    /** Not needed for a booker salary (it has its own category). */
    categoryId: optionalId,
    amount: moneySchema("amount").refine((v) => Number(v) > 0, "The amount must be more than zero"),
    method: z.enum(PAYMENT_METHODS, { error: "Choose how it was paid" }),
    warehouseId: optionalId,
    bikeId: optionalId,
    tripId: optionalId,
    staffId: optionalId,
    paidTo: optionalText(120),
    note: optionalText(300),
  })
  .superRefine((e, ctx) => {
    if (e.chargeTo !== "OWN" && !e.companyId)
      ctx.addIssue({
        code: "custom",
        path: ["companyId"],
        message: "Choose the company that pays it back",
      });
    if (e.chargeTo !== "BOOKER_SALARY" && !e.categoryId)
      ctx.addIssue({ code: "custom", path: ["categoryId"], message: "Choose the category" });
  });

export const expenseCategorySchema = z.object({
  name: z.preprocess(
    blankToUndefined,
    z
      .string({ error: "Enter the category name" })
      .min(2, "Enter the category name")
      .max(60, "Keep the name under 60 characters"),
  ),
});

export type ExpenseInput = z.infer<typeof expenseSchema>;
