import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { loadByProduct, takeFromBatches } from "@/lib/delivery";
import { formatDozens } from "@/lib/units";

import type { TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";
import type { ServiceCtx } from "../master/common";
import { batchBalances } from "../posting";
import type { FrozenPrevious } from "./bills";
import { customerPending } from "./positions";

// Posting a sale: the stock leaves the warehouse and the bill goes to the customer ledger. Used by
// trip dispatch (delivery/trips.ts) and by counter sales (counter.ts), so both post the same way.

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

/** Refuses when the warehouse has less saleable stock on hand than these lines take. */
export async function assertStockOnHand(
  tx: TenantTx,
  warehouseId: string,
  lines: { productId: string; quantity: number; product: { name: string } }[],
) {
  const load = loadByProduct(lines);
  const onHand = await tx.stockMovement.groupBy({
    by: ["productId"],
    where: { warehouseId, bucket: "SALEABLE", productId: { in: [...load.keys()] } },
    _sum: { quantity: true },
  });
  const have = new Map(onHand.map((g) => [g.productId, g._sum.quantity ?? 0]));
  const names = new Map(lines.map((l) => [l.productId, l.product.name]));
  const short = [...load]
    .filter(([pid, qty]) => qty > (have.get(pid) ?? 0))
    .map(
      ([pid, qty]) =>
        `${names.get(pid)} (needs ${formatDozens(qty)}, ${formatDozens(Math.max(have.get(pid) ?? 0, 0))} on hand)`,
    );
  if (short.length > 0) throw new ServiceError(`Not enough stock: ${short.join("; ")}.`);
}

/** Saleable stock movements out of the warehouse for one line, oldest batches first. */
export async function stockOut(
  tx: TenantTx,
  ctx: ServiceCtx,
  m: { productId: string; warehouseId: string; quantity: number; orderId: string; at: Date },
  batchLeft: Map<string, { id: string; available: number }[]>,
) {
  let batches = batchLeft.get(m.productId);
  if (!batches) {
    const rows = await tx.batch.findMany({
      where: { productId: m.productId, warehouseId: m.warehouseId },
      orderBy: [{ receivedDate: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const balances = await batchBalances(
      tx,
      rows.map((r) => r.id),
    );
    batches = rows.map((r) => ({ id: r.id, available: balances.get(r.id) ?? 0 }));
    batchLeft.set(m.productId, batches);
  }
  const { slices, unbatched } = takeFromBatches(m.quantity, batches);
  for (const s of slices) batches.find((b) => b.id === s.batchId)!.available -= s.quantity;
  const parts: { batchId: string | null; quantity: number }[] = [
    ...slices,
    ...(unbatched > 0 ? [{ batchId: null, quantity: unbatched }] : []),
  ];
  for (const part of parts) {
    await tx.stockMovement.create({
      data: {
        tenantId: ctx.user.tenantId,
        type: "DISPATCH",
        productId: m.productId,
        warehouseId: m.warehouseId,
        batchId: part.batchId,
        bucket: "SALEABLE",
        quantity: -part.quantity,
        occurredAt: m.at,
        referenceType: "SalesOrder",
        referenceId: m.orderId,
        createdById: ctx.user.id,
      },
    });
  }
}

/**
 * Posts an order's bill to the customer ledger (one entry per company slice) dated `date`, and
 * freezes the customer's previous pending (overall and per company) for printing.
 */
export async function postOrderBill(
  tx: TenantTx,
  ctx: ServiceCtx,
  order: {
    id: string;
    number: number;
    customerId: string;
    lines: { companyId: string; netAmount: Prisma.Decimal }[];
    bill: { id: string; number: number } | null;
  },
  date: Date,
) {
  const bill = order.bill!;
  const pending = await customerPending(tx, order.customerId);
  const frozen: FrozenPrevious = [...pending.byCompany]
    .filter(([, v]) => !v.isZero())
    .map(([companyId, amount]) => ({ companyId, amount: amount.toFixed(2) }));
  await tx.bill.update({
    where: { id: bill.id },
    data: {
      postedAt: new Date(),
      billDate: date,
      previousBalance: pending.total,
      previousByCompany: frozen,
    },
  });
  const byCompany = new Map<string, Prisma.Decimal>();
  for (const l of order.lines)
    byCompany.set(l.companyId, (byCompany.get(l.companyId) ?? D(0)).add(l.netAmount));
  for (const [companyId, amount] of byCompany) {
    if (amount.isZero()) continue;
    await tx.ledgerEntry.create({
      data: {
        tenantId: ctx.user.tenantId,
        partyType: "CUSTOMER",
        customerId: order.customerId,
        companyId,
        type: "SALES_BILL",
        entryDate: date,
        debit: amount,
        description: `Bill #${bill.number} (order #${order.number})`,
        referenceType: "Bill",
        referenceId: bill.id,
        createdById: ctx.user.id,
      },
    });
  }
}
