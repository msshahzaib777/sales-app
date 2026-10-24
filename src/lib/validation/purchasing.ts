import { z } from "zod";

import {
  blankToUndefined,
  dateSchema,
  dozensSchema,
  idSchema,
  moneySchema,
  optionalDateSchema,
  optionalMoneySchema,
  optionalText,
  packetsSchema,
  requestIdSchema,
} from "./master";

// Purchasing validation, shared by forms, server actions and services.

/** One product line: quantity in dozens (→ packets); rate per dozen only for roles that see cost. */
export const purchaseLineSchema = z.object({
  productId: idSchema,
  quantity: dozensSchema("quantity", { min: 0.5 }),
  rate: optionalMoneySchema("rate"),
});

const linesSchema = z
  .array(purchaseLineSchema)
  .min(1, "Enter a quantity for at least one product")
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

export const purchaseOrderSchema = z.object({
  requestId: requestIdSchema,
  companyId: idSchema,
  orderDate: dateSchema("order date"),
  expectedDate: optionalDateSchema("expected date"),
  note: optionalText(500),
  lines: linesSchema,
});

export const goodsReceiptSchema = z.object({
  requestId: requestIdSchema,
  companyId: idSchema,
  purchaseOrderId: z.preprocess(blankToUndefined, idSchema.optional()).transform((v) => v ?? null),
  receivedDate: dateSchema("received date"),
  /** Override of receipt date + payment terms (owner/accountant only). */
  dueDate: optionalDateSchema("due date"),
  supplierRef: optionalText(60),
  note: optionalText(500),
  lines: linesSchema,
});

export const PAYMENT_METHODS = ["CASH", "CHEQUE", "ONLINE"] as const;

export const allocationSchema = z.object({ billId: idSchema, amount: moneySchema("amount") });

export const companyPaymentSchema = z
  .object({
    requestId: requestIdSchema,
    companyId: idSchema,
    paymentDate: dateSchema("payment date"),
    method: z.enum(PAYMENT_METHODS, { error: "Choose how it was paid" }),
    amount: moneySchema("amount").refine((v) => Number(v) > 0, "The amount must be more than zero"),
    reference: optionalText(80),
    chequeNo: optionalText(30),
    bankName: optionalText(60),
    chequeDate: optionalDateSchema("cheque date"),
    note: optionalText(500),
    /** auto = oldest bills first; manual = the allocations below. */
    allocationMode: z.enum(["auto", "manual"]).default("auto"),
    allocations: z.array(allocationSchema).max(500).default([]),
  })
  .superRefine((p, ctx) => {
    if (p.method === "CHEQUE") {
      if (!p.chequeNo)
        ctx.addIssue({ code: "custom", path: ["chequeNo"], message: "Enter the cheque number" });
      if (!p.bankName)
        ctx.addIssue({ code: "custom", path: ["bankName"], message: "Enter the bank" });
      if (!p.chequeDate)
        ctx.addIssue({ code: "custom", path: ["chequeDate"], message: "Enter the cheque date" });
    }
  });

// Damaged stock sent back to the company is a stock movement only (inventory.ts); its credit was
// the damage claim, so it is not a claim type here.
export const CLAIM_TYPES = ["DELIVERY_DAMAGE", "OTHER"] as const;

export const claimSchema = z.object({
  requestId: requestIdSchema,
  companyId: idSchema,
  productId: idSchema,
  type: z.enum(CLAIM_TYPES, { error: "Choose the claim type" }),
  claimDate: dateSchema("claim date"),
  quantity: packetsSchema("quantity", { min: 1 }),
  rate: optionalMoneySchema("rate"),
  note: optionalText(500),
});

export const reverseSchema = z.object({
  id: idSchema,
  reason: z.preprocess(blankToUndefined, z.string({ error: "Say why" }).min(3, "Say why").max(300)),
});

export const dueDateSchema = z.object({ billId: idSchema, dueDate: dateSchema("due date") });

export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;
export type GoodsReceiptInput = z.infer<typeof goodsReceiptSchema>;
export type CompanyPaymentInput = z.infer<typeof companyPaymentSchema>;
export type ClaimInput = z.infer<typeof claimSchema>;
