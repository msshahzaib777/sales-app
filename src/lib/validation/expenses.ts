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

/** One expense (SPEC §9). Warehouse, bike, trip and staff are optional links for reports. */
export const expenseSchema = z.object({
  requestId: requestIdSchema,
  expenseDate: dateSchema("date"),
  categoryId: z.string({ error: "Choose the category" }).min(1, "Choose the category").max(40),
  amount: moneySchema("amount").refine((v) => Number(v) > 0, "The amount must be more than zero"),
  method: z.enum(PAYMENT_METHODS, { error: "Choose how it was paid" }),
  warehouseId: optionalId,
  bikeId: optionalId,
  tripId: optionalId,
  staffId: optionalId,
  paidTo: optionalText(120),
  note: optionalText(300),
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
