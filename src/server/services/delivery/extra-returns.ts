import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { calculateLineAmounts, type DiscountType } from "@/lib/pricing";
import { formatDozens, PACKETS_PER_DOZEN } from "@/lib/units";
import type { ExtraReturnInput } from "@/lib/validation/delivery";

import type { TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";
import type { ServiceCtx } from "../master/common";
import { reverseLedgerFor } from "../posting";

// Day-end returns of goods from an EARLIER sale (not today's order): the customer gives back any
// product, at a rate agreed for the return, or "Other" (something not in the product list, e.g.
// discontinued) at a custom rate. A product goes back into its company's warehouse (saleable or
// damaged stock); "Other" moves no stock. The amount is credited to the customer for the company
// (CLAUDE.md rule 3). The driver's sheets do not change: these are entered from the signed bill.

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

/** What the day-end screens need to add a return: products, companies, the customer's last rates. */
export async function extraReturnOptions(ctx: ServiceCtx, customerIds: string[]) {
  const [products, companies, lines] = await Promise.all([
    ctx.db.product.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        isActive: true,
        companyId: true,
        saleRate: true,
        discountType: true,
        discountValue: true,
        company: { select: { name: true } },
      },
      orderBy: [{ isActive: "desc" }, { code: "asc" }],
    }),
    ctx.db.company.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    customerIds.length === 0
      ? Promise.resolve([])
      : ctx.db.salesOrderLine.findMany({
          where: {
            salesOrder: {
              customerId: { in: customerIds },
              status: { in: ["DISPATCHED", "DELIVERED", "PARTIALLY_DELIVERED"] },
            },
          },
          select: {
            productId: true,
            quantity: true,
            netAmount: true,
            salesOrder: { select: { customerId: true } },
          },
          orderBy: [{ salesOrder: { orderDate: "desc" } }, { salesOrder: { number: "desc" } }],
          take: 5000,
        }),
  ]);
  // The rate the customer last paid per dozen (after discount): what a return is usually credited at.
  const lastRates: Record<string, Record<string, string>> = {};
  for (const l of lines) {
    const byProduct = (lastRates[l.salesOrder.customerId] ??= {});
    if (byProduct[l.productId] || l.quantity <= 0) continue;
    byProduct[l.productId] = l.netAmount
      .mul(PACKETS_PER_DOZEN)
      .div(l.quantity)
      .toDecimalPlaces(2)
      .toFixed(2);
  }
  return {
    products: products.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      active: p.isActive,
      companyId: p.companyId,
      companyName: p.company.name,
      // The normal rate per dozen after the product's own discount.
      rate: D(
        calculateLineAmounts({
          quantity: PACKETS_PER_DOZEN,
          baseUnitsPerPriceUnit: PACKETS_PER_DOZEN,
          rate: p.saleRate.toString(),
          discountType: p.discountType as DiscountType,
          discountValue: p.discountValue.toString(),
        }).netAmount.toString(),
      ).toFixed(2),
    })),
    companies,
    lastRates,
  };
}

export type ExtraReturnOptions = Awaited<ReturnType<typeof extraReturnOptions>>;

/** Credit for a return: quantity (packets) × rate per dozen, to the paisa. */
export function returnAmount(quantity: number, rate: string | Prisma.Decimal) {
  return D(
    calculateLineAmounts({
      quantity,
      baseUnitsPerPriceUnit: PACKETS_PER_DOZEN,
      rate: rate.toString(),
    }).netAmount.toString(),
  );
}

/** Posts one delivery's returns of earlier goods: return rows, stock back in, customer credit. */
export async function postExtraReturns(
  tx: TenantTx,
  ctx: ServiceCtx,
  order: { id: string; number: number; customerId: string },
  extras: ExtraReturnInput[],
  date: Date,
) {
  if (extras.length === 0) return [];
  const productIds = [...new Set(extras.flatMap((e) => (e.productId ? [e.productId] : [])))];
  const companyIds = [...new Set(extras.flatMap((e) => (e.productId ? [] : [e.companyId!])))];
  const [products, companies] = await Promise.all([
    tx.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        code: true,
        name: true,
        companyId: true,
        company: { select: { warehouseId: true } },
      },
    }),
    tx.company.findMany({ where: { id: { in: companyIds } }, select: { id: true } }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const knownCompanies = new Set(companies.map((c) => c.id));

  const posted: { id: string; label: string; quantity: number; rate: string; amount: string }[] =
    [];
  for (const e of extras) {
    const product = e.productId ? productById.get(e.productId) : null;
    if (e.productId && !product)
      throw new ServiceError("A returned product was not found. Reload the page.");
    if (!product && !knownCompanies.has(e.companyId!))
      throw new ServiceError("The company of an “Other” return was not found.");
    const companyId = product ? product.companyId : e.companyId!;
    const label = product ? `${product.code} ${product.name}` : `Other: ${e.description}`;
    const amount = returnAmount(e.quantity, e.rate);
    const ret = await tx.customerReturn.create({
      data: {
        tenantId: ctx.user.tenantId,
        salesOrderId: order.id,
        customerId: order.customerId,
        productId: product?.id ?? null,
        companyId,
        description: product ? null : e.description,
        quantity: e.quantity,
        rate: D(e.rate),
        amount,
        bucket: product ? (e.damaged ? "DAMAGED" : "SALEABLE") : null,
        returnDate: date,
        createdById: ctx.user.id,
      },
    });
    if (product) {
      await tx.stockMovement.create({
        data: {
          tenantId: ctx.user.tenantId,
          type: "CUSTOMER_RETURN",
          productId: product.id,
          warehouseId: product.company.warehouseId,
          bucket: e.damaged ? "DAMAGED" : "SALEABLE",
          quantity: e.quantity,
          occurredAt: date,
          referenceType: "CustomerReturn",
          referenceId: ret.id,
          note: `returned with order #${order.number} (earlier goods)`,
          createdById: ctx.user.id,
        },
      });
    }
    if (amount.gt(0)) {
      await tx.ledgerEntry.create({
        data: {
          tenantId: ctx.user.tenantId,
          partyType: "CUSTOMER",
          customerId: order.customerId,
          companyId,
          type: "CUSTOMER_RETURN",
          entryDate: date,
          credit: amount,
          description: `Return: ${label}, ${formatDozens(e.quantity)} at Rs ${D(e.rate).toFixed(2)}/dz (order #${order.number})`,
          referenceType: "CustomerReturn",
          referenceId: ret.id,
          createdById: ctx.user.id,
        },
      });
    }
    posted.push({
      id: ret.id,
      label: `${label}${product && e.damaged ? " (damaged)" : ""}`,
      quantity: e.quantity,
      rate: D(e.rate).toFixed(2),
      amount: amount.toFixed(2),
    });
  }
  return posted;
}

/**
 * Reverses an order's returns of earlier goods (undoing its day-end): stock back out (refused when
 * that stock is already used), the credit reversed, each row marked reversed.
 */
export async function reverseExtraReturns(
  tx: TenantTx,
  ctx: ServiceCtx,
  orderId: string,
  entryDate: Date,
  note: string,
) {
  const returns = await tx.customerReturn.findMany({
    where: { salesOrderId: orderId, reversedAt: null },
    include: { product: { select: { name: true } } },
  });
  if (returns.length === 0) return [];
  const moves = await tx.stockMovement.findMany({
    where: {
      referenceType: "CustomerReturn",
      referenceId: { in: returns.map((r) => r.id) },
      reversedBy: { none: {} },
    },
  });
  for (const m of moves) {
    const balance = await tx.stockMovement.aggregate({
      where: { productId: m.productId, warehouseId: m.warehouseId, bucket: m.bucket },
      _sum: { quantity: true },
    });
    if ((balance._sum.quantity ?? 0) < m.quantity) {
      const name = returns.find((r) => r.id === m.referenceId)?.product?.name ?? "A product";
      throw new ServiceError(
        `${name}: the stock the customer gave back with this order has already been used, so the day-end cannot be undone.`,
      );
    }
    await tx.stockMovement.create({
      data: {
        tenantId: ctx.user.tenantId,
        type: "REVERSAL",
        productId: m.productId,
        warehouseId: m.warehouseId,
        batchId: m.batchId,
        bucket: m.bucket,
        quantity: -m.quantity,
        occurredAt: entryDate,
        referenceType: m.referenceType,
        referenceId: m.referenceId,
        reversalOfId: m.id,
        note,
        createdById: ctx.user.id,
      },
    });
  }
  for (const r of returns)
    await reverseLedgerFor(tx, ctx, { type: "CustomerReturn", id: r.id }, entryDate, note);
  await tx.customerReturn.updateMany({
    where: { id: { in: returns.map((r) => r.id) } },
    data: { reversedAt: new Date() },
  });
  return returns.map((r) => ({ id: r.id, amount: r.amount }));
}
