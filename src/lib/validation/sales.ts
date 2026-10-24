import { z } from "zod";

import {
  blankToUndefined,
  dateSchema,
  dozensSchema,
  idSchema,
  optionalText,
  requestIdSchema,
} from "./master";

export const ORDER_SOURCES = ["OFFICE", "WHATSAPP", "BOOKER_APP"] as const;

export const salesOrderLineSchema = z.object({
  productId: idSchema,
  quantity: dozensSchema("quantity", { min: 1 }),
});

export const salesOrderSchema = z
  .object({
    requestId: requestIdSchema,
    customerId: idSchema,
    /** Only needed when the customer has no area (the area decides the warehouse). */
    warehouseId: z.preprocess(blankToUndefined, idSchema.optional()).transform((v) => v ?? null),
    orderDate: dateSchema("order date"),
    deliveryDate: dateSchema("delivery date"),
    source: z.enum(ORDER_SOURCES).default("OFFICE"),
    note: optionalText(500),
    /** The owner ticked "allow past the credit limit". */
    allowOverCredit: z
      .preprocess((v) => v === true || v === "true" || v === "on", z.boolean())
      .default(false),
    lines: z
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
      }),
  })
  .refine((o) => o.deliveryDate >= o.orderDate, {
    path: ["deliveryDate"],
    message: "Delivery cannot be before the order date",
  });

export type SalesOrderInput = z.infer<typeof salesOrderSchema>;
