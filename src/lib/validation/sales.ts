import { z } from "zod";

import {
  blankToUndefined,
  dateSchema,
  dozensSchema,
  idSchema,
  optionalDateSchema,
  optionalMoneySchema,
  optionalText,
  requestIdSchema,
} from "./master";
import { PAYMENT_METHODS } from "./purchasing";

export const ORDER_SOURCES = ["OFFICE", "WHATSAPP", "BOOKER_APP"] as const;

export const salesOrderLineSchema = z.object({
  productId: idSchema,
  quantity: dozensSchema("quantity", { min: 0.5 }),
  /** A rate per dozen changed for this order; blank = the product's rate and discount. */
  rate: optionalMoneySchema("rate").refine((v) => v === null || Number(v) > 0, {
    message: "The rate must be more than zero",
  }),
  rateNote: optionalText(100),
});

const orderLinesSchema = z
  .array(salesOrderLineSchema)
  .min(1, "Add at least one product")
  .max(200)
  .superRefine((lines, ctx) => {
    const seen = new Set<string>();
    lines.forEach((l, i) => {
      if (seen.has(l.productId))
        ctx.addIssue({
          code: "custom",
          path: [i, "productId"],
          message: "A product appears twice",
        });
      seen.add(l.productId);
    });
  });

/** The owner ticked "allow past the credit limit". */
const allowOverCreditSchema = z
  .preprocess((v) => v === true || v === "true" || v === "on", z.boolean())
  .default(false);

/** Only needed when the customer has no area (the area decides the warehouse). */
const warehouseIdSchema = z
  .preprocess(blankToUndefined, idSchema.optional())
  .transform((v) => v ?? null);

export const salesOrderSchema = z
  .object({
    requestId: requestIdSchema,
    customerId: idSchema,
    warehouseId: warehouseIdSchema,
    orderDate: dateSchema("order date"),
    deliveryDate: dateSchema("delivery date"),
    source: z.enum(ORDER_SOURCES).default("OFFICE"),
    note: optionalText(500),
    allowOverCredit: allowOverCreditSchema,
    lines: orderLinesSchema,
  })
  .refine((o) => o.deliveryDate >= o.orderDate, {
    path: ["deliveryDate"],
    message: "Delivery cannot be before the order date",
  });

export type SalesOrderInput = z.infer<typeof salesOrderSchema>;

/**
 * A counter sale: the customer collects the goods at the warehouse. Anything not paid now goes
 * on the customer's account.
 */
export const counterSaleSchema = z
  .object({
    requestId: requestIdSchema,
    customerId: idSchema,
    warehouseId: warehouseIdSchema,
    saleDate: dateSchema("sale date"),
    note: optionalText(500),
    allowOverCredit: allowOverCreditSchema,
    lines: orderLinesSchema,
    /** Paid at the counter (blank: all on account). */
    paidAmount: optionalMoneySchema("amount paid"),
    method: z.enum(PAYMENT_METHODS).default("CASH"),
    reference: optionalText(80),
    chequeNo: optionalText(30),
    bankName: optionalText(60),
    chequeDate: optionalDateSchema("cheque date"),
  })
  .superRefine((s, ctx) => {
    if (!s.paidAmount || Number(s.paidAmount) <= 0 || s.method !== "CHEQUE") return;
    if (!s.chequeNo)
      ctx.addIssue({ code: "custom", path: ["chequeNo"], message: "Enter the cheque number" });
    if (!s.bankName)
      ctx.addIssue({ code: "custom", path: ["bankName"], message: "Enter the bank" });
    if (!s.chequeDate)
      ctx.addIssue({ code: "custom", path: ["chequeDate"], message: "Enter the cheque date" });
  });

export type CounterSaleInput = z.infer<typeof counterSaleSchema>;
