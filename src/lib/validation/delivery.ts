import { z } from "zod";

import {
  blankAs,
  blankToUndefined,
  dateSchema,
  dozensSchema,
  idSchema,
  optionalDateSchema,
  optionalMoneySchema,
  optionalText,
  requestIdSchema,
} from "./master";

const orderIds = z
  .preprocess(
    (v) => (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : []),
    z.array(idSchema).max(200),
  )
  .transform((ids) => [...new Set(ids)]);

export const tripSchema = z.object({
  requestId: requestIdSchema,
  tripDate: dateSchema("delivery date"),
  bikeId: z.string({ error: "Choose a bike" }).min(1, "Choose a bike").max(40),
  /** Optional: often chosen when the trip leaves, or later. */
  driverId: z.preprocess(blankToUndefined, idSchema.optional()).transform((v) => v ?? null),
  note: optionalText(300),
  orderIds: orderIds.refine((ids) => ids.length > 0, "Tick at least one order"),
});

export const tripOrdersSchema = z.object({
  tripId: idSchema,
  orderIds: orderIds.refine((ids) => ids.length > 0, "Tick at least one order"),
});

export const tripDriverSchema = z.object({
  tripId: idSchema,
  driverId: z.preprocess(blankToUndefined, idSchema.optional()).transform((v) => v ?? null),
});

export const tripOrderSchema = z.object({ tripId: idSchema, orderId: idSchema });

const dozensOrZero = (label: string) => blankAs(dozensSchema(label), 0);
const amount = (label: string) =>
  optionalMoneySchema(label).transform((v) => (v === null || Number(v) === 0 ? null : v));

/** One order's day-end entry from the signed bill. Quantities in dozens, amounts in rupees. */
export const dayEndSchema = z
  .object({
    requestId: requestIdSchema,
    orderId: idSchema,
    lines: z
      .array(
        z.object({
          productId: idSchema,
          returned: dozensOrZero("returned quantity"),
          damaged: dozensOrZero("damaged quantity"),
        }),
      )
      .max(200)
      .default([]),
    cash: amount("cash"),
    chequeAmount: amount("cheque amount"),
    chequeNo: optionalText(30),
    bankName: optionalText(60),
    chequeDate: optionalDateSchema("cheque date"),
    onlineAmount: amount("online amount"),
    onlineReference: optionalText(80),
    note: optionalText(300),
  })
  .superRefine((d, ctx) => {
    if (d.chequeAmount) {
      if (!d.chequeNo)
        ctx.addIssue({ code: "custom", path: ["chequeNo"], message: "Enter the cheque number" });
      if (!d.bankName)
        ctx.addIssue({ code: "custom", path: ["bankName"], message: "Enter the bank" });
      if (!d.chequeDate)
        ctx.addIssue({ code: "custom", path: ["chequeDate"], message: "Enter the cheque date" });
    }
  });

export type TripInput = z.infer<typeof tripSchema>;
export type DayEndInput = z.infer<typeof dayEndSchema>;
