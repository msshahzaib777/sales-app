import { z } from "zod";

import {
  dateSchema,
  idSchema,
  moneySchema,
  optionalDateSchema,
  optionalText,
  requestIdSchema,
} from "./master";
import { PAYMENT_METHODS } from "./purchasing";

/** A payment received at the office. */
export const customerPaymentSchema = z
  .object({
    requestId: requestIdSchema,
    customerId: z.string({ error: "Choose the customer" }).min(1, "Choose the customer").max(40),
    paymentDate: dateSchema("payment date"),
    method: z.enum(PAYMENT_METHODS, { error: "Choose how it was paid" }),
    amount: moneySchema("amount").refine((v) => Number(v) > 0, "The amount must be more than zero"),
    reference: optionalText(80),
    chequeNo: optionalText(30),
    bankName: optionalText(60),
    chequeDate: optionalDateSchema("cheque date"),
    note: optionalText(500),
    /** auto = oldest debt first; company = the amounts per company below. */
    allocationMode: z.enum(["auto", "company"]).default("auto"),
    companyAmounts: z
      .array(
        z.object({
          // "" = the old balance (see OLD_BALANCE in src/lib/payments.ts).
          companyId: z.union([idSchema, z.literal("")]),
          amount: moneySchema("company amount"),
        }),
      )
      .max(100)
      .default([]),
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

export type CustomerPaymentInput = z.infer<typeof customerPaymentSchema>;

/** An unpaid paper bill from before the app (the customer's old balance; no company). */
export const oldBillSchema = z.object({
  requestId: requestIdSchema,
  customerId: idSchema,
  billDate: dateSchema("bill date"),
  billNo: optionalText(30),
  amount: moneySchema("amount").refine((v) => Number(v) > 0, "The amount must be more than zero"),
  note: optionalText(200),
});
