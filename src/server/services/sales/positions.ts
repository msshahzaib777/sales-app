import "server-only";

import { Prisma } from "@/generated/prisma/client";

import type { TenantTx } from "../../db/tenant";

type Reader = Pick<TenantTx, "stockMovement" | "salesOrderLine" | "ledgerEntry" | "bill">;
const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

export type StockPosition = { onHand: number; reserved: number; available: number };

/**
 * Stock per product in a warehouse (SPEC §5): on hand = sum of saleable movements; reserved = lines
 * of booked/planned orders (optionally not counting one order, e.g. the one being edited);
 * available = on hand − reserved. All in half dozens.
 */
export async function stockPositions(
  tx: Reader,
  warehouseId: string,
  productIds?: string[],
  excludeOrderId?: string,
) {
  const productFilter = productIds ? { productId: { in: productIds } } : {};
  const [moves, reserved] = await Promise.all([
    tx.stockMovement.groupBy({
      by: ["productId"],
      where: { warehouseId, bucket: "SALEABLE", ...productFilter },
      _sum: { quantity: true },
    }),
    tx.salesOrderLine.groupBy({
      by: ["productId"],
      where: {
        ...productFilter,
        salesOrder: {
          warehouseId,
          status: { in: ["BOOKED", "PLANNED"] },
          ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
        },
      },
      _sum: { quantity: true },
    }),
  ]);
  const result = new Map<string, StockPosition>();
  const get = (id: string) => result.get(id) ?? { onHand: 0, reserved: 0, available: 0 };
  for (const m of moves)
    result.set(m.productId, { ...get(m.productId), onHand: m._sum.quantity ?? 0 });
  for (const r of reserved)
    result.set(r.productId, { ...get(r.productId), reserved: r._sum.quantity ?? 0 });
  for (const [id, p] of result) result.set(id, { ...p, available: p.onHand - p.reserved });
  return result;
}

/** What the customer owes now, overall and per company (posted ledger entries only). */
export async function customerPending(tx: Reader, customerId: string) {
  const groups = await tx.ledgerEntry.groupBy({
    by: ["companyId"],
    where: { partyType: "CUSTOMER", customerId },
    _sum: { debit: true, credit: true },
  });
  const byCompany = new Map<string, Prisma.Decimal>();
  let total = D(0);
  for (const g of groups) {
    const amount = D(g._sum.debit ?? 0).sub(g._sum.credit ?? 0);
    byCompany.set(g.companyId!, amount);
    total = total.add(amount);
  }
  return { total, byCompany };
}

/** Bills of the customer's open (not yet dispatched) orders: committed but not in the ledger yet. */
export async function openOrdersTotal(tx: Reader, customerId: string, excludeOrderId?: string) {
  const sum = await tx.bill.aggregate({
    where: {
      customerId,
      postedAt: null,
      status: "POSTED",
      salesOrder: {
        status: { in: ["BOOKED", "PLANNED"] },
        ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
      },
    },
    _sum: { netAmount: true },
  });
  return D(sum._sum.netAmount ?? 0);
}
