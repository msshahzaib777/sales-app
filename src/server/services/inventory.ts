import "server-only";

import { z } from "zod";

import type { Prisma } from "@/generated/prisma/client";
import type { StockMovementType } from "@/generated/prisma/enums";

import { formatDozens } from "@/lib/units";
import {
  dateSchema,
  dozensSchema,
  idSchema,
  optionalText,
  requestIdSchema,
} from "@/lib/validation/master";

import { writeAudit } from "../audit";
import { assertCan } from "../auth/permissions";
import { ServiceError } from "./errors";
import { PAGE_SIZE, paged, type ServiceCtx } from "./master/common";
import { found } from "./posting";
import type { DateRange } from "./purchasing/filters";
import { stockPositions } from "./sales/positions";

// Inventory (SPEC §5): stock per product per warehouse, always rebuilt from the stock journal.
// On hand = saleable movements; reserved = booked and planned orders; available = on hand −
// reserved; damaged = the damaged bucket. Quantities in half dozens. No costs: staff see this.

const returnDamagedSchema = z.object({
  requestId: requestIdSchema,
  productId: idSchema,
  quantity: dozensSchema("quantity", { min: 1 }),
  returnDate: dateSchema("date"),
  note: optionalText(300),
});

export const MOVEMENT_LABEL: Record<StockMovementType, string> = {
  OPENING: "Opening stock",
  GOODS_RECEIPT: "Goods received",
  DISPATCH: "Dispatched",
  CUSTOMER_RETURN: "Returned by customer",
  DELIVERY_DAMAGE: "Damaged in delivery",
  RETURN_TO_COMPANY: "Returned to company",
  ADJUSTMENT: "Adjustment",
  REVERSAL: "Reversal",
};

export type StockFilters = {
  q?: string;
  warehouseId?: string;
  companyId?: string;
  /** Only products below their minimum level. */
  low?: boolean;
  page: number;
};

export async function listStock(ctx: ServiceCtx, f: StockFilters) {
  assertCan(ctx.user.role, "operations.manage");
  const where: Prisma.ProductWhereInput = {
    isActive: true,
    ...(f.companyId ? { companyId: f.companyId } : {}),
    ...(f.warehouseId ? { company: { warehouseId: f.warehouseId } } : {}),
    ...(f.q
      ? {
          OR: [
            { code: { contains: f.q, mode: "insensitive" } },
            { name: { contains: f.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const products = await ctx.db.product.findMany({
    where,
    orderBy: [{ company: { name: "asc" } }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      minStockLevel: true,
      company: { select: { name: true, warehouseId: true, warehouse: { select: { name: true } } } },
    },
  });
  // Positions per warehouse (each product's stock lives in its company's warehouse).
  const byWarehouse = new Map<string, string[]>();
  for (const p of products)
    byWarehouse.set(p.company.warehouseId, [
      ...(byWarehouse.get(p.company.warehouseId) ?? []),
      p.id,
    ]);
  const positions = new Map<string, { onHand: number; reserved: number; available: number }>();
  const damaged = new Map<string, number>();
  for (const [warehouseId, ids] of byWarehouse) {
    for (const [id, pos] of await stockPositions(ctx.db, warehouseId, ids)) positions.set(id, pos);
    const groups = await ctx.db.stockMovement.groupBy({
      by: ["productId"],
      where: { warehouseId, bucket: "DAMAGED", productId: { in: ids } },
      _sum: { quantity: true },
    });
    for (const g of groups) damaged.set(g.productId, g._sum.quantity ?? 0);
  }
  const rows = products
    .map((p) => {
      const pos = positions.get(p.id) ?? { onHand: 0, reserved: 0, available: 0 };
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        companyName: p.company.name,
        warehouseName: p.company.warehouse.name,
        minStockLevel: p.minStockLevel,
        ...pos,
        damaged: damaged.get(p.id) ?? 0,
        low: p.minStockLevel > 0 && pos.available < p.minStockLevel,
      };
    })
    .filter((r) => !f.low || r.low);
  const totals = {
    onHand: rows.reduce((s, r) => s + r.onHand, 0),
    reserved: rows.reduce((s, r) => s + r.reserved, 0),
    damaged: rows.reduce((s, r) => s + r.damaged, 0),
    low: rows.filter((r) => r.low).length,
  };
  return {
    ...paged(rows.slice((f.page - 1) * PAGE_SIZE, f.page * PAGE_SIZE), rows.length, f.page),
    totals,
  };
}

const REFERENCE_HREF: Record<string, (id: string) => string> = {
  GoodsReceipt: (id) => `/purchases/receipts/${id}`,
  SalesOrder: (id) => `/orders/${id}`,
};

/**
 * Stock card: every movement of one product in a period with running saleable and damaged
 * balances, starting from the balance before the period.
 */
export async function getStockCard(ctx: ServiceCtx, productId: string, range: DateRange) {
  assertCan(ctx.user.role, "operations.manage");
  const product = found(
    await ctx.db.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        code: true,
        name: true,
        minStockLevel: true,
        company: {
          select: { name: true, warehouseId: true, warehouse: { select: { name: true } } },
        },
      },
    }),
    "product",
  );
  const warehouseId = product.company.warehouseId;
  const before = range.from
    ? await ctx.db.stockMovement.groupBy({
        by: ["bucket"],
        where: { productId, warehouseId, occurredAt: { lt: range.from } },
        _sum: { quantity: true },
      })
    : [];
  const opening = {
    saleable: before.find((b) => b.bucket === "SALEABLE")?._sum.quantity ?? 0,
    damaged: before.find((b) => b.bucket === "DAMAGED")?._sum.quantity ?? 0,
  };
  const end = range.to ? new Date(range.to.getTime() + 86_400_000) : undefined;
  const movements = await ctx.db.stockMovement.findMany({
    where: {
      productId,
      warehouseId,
      ...(range.from || end
        ? {
            occurredAt: { ...(range.from ? { gte: range.from } : {}), ...(end ? { lt: end } : {}) },
          }
        : {}),
    },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
  });
  let saleable = opening.saleable;
  let damagedBalance = opening.damaged;
  const rows = movements.map((m) => {
    if (m.bucket === "SALEABLE") saleable += m.quantity;
    else damagedBalance += m.quantity;
    return {
      id: m.id,
      occurredAt: m.occurredAt,
      typeLabel: MOVEMENT_LABEL[m.type],
      bucket: m.bucket,
      quantity: m.quantity,
      saleable,
      damaged: damagedBalance,
      note: m.note,
      href:
        m.referenceType && m.referenceId
          ? (REFERENCE_HREF[m.referenceType]?.(m.referenceId) ?? null)
          : null,
    };
  });
  const [positions, damagedNow] = await Promise.all([
    stockPositions(ctx.db, warehouseId, [productId]),
    ctx.db.stockMovement.aggregate({
      where: { productId, warehouseId, bucket: "DAMAGED" },
      _sum: { quantity: true },
    }),
  ]);
  return {
    product: {
      id: product.id,
      code: product.code,
      name: product.name,
      companyName: product.company.name,
      warehouseName: product.company.warehouse.name,
      minStockLevel: product.minStockLevel,
    },
    opening,
    rows,
    closing: { saleable, damaged: damagedBalance },
    now: positions.get(productId) ?? { onHand: 0, reserved: 0, available: 0 },
    damagedNow: damagedNow._sum.quantity ?? 0,
  };
}

/**
 * Damaged stock sent back to the company (SPEC §5): stock leaves the damaged bucket. No money
 * moves here: the company was already credited when the damage was claimed at day-end.
 */
export async function returnDamagedStock(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "operations.manage");
  const data = returnDamagedSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    if (data.requestId) {
      const done = await tx.stockMovement.findFirst({ where: { requestId: data.requestId } });
      if (done) return done;
    }
    const product = found(
      await tx.product.findUnique({
        where: { id: data.productId },
        select: { id: true, name: true, company: { select: { warehouseId: true, name: true } } },
      }),
      "product",
    );
    const warehouseId = product.company.warehouseId;
    const damaged = await tx.stockMovement.aggregate({
      where: { productId: product.id, warehouseId, bucket: "DAMAGED" },
      _sum: { quantity: true },
    });
    const have = damaged._sum.quantity ?? 0;
    if (data.quantity > have)
      throw new ServiceError(
        `Only ${formatDozens(Math.max(have, 0))} of ${product.name} is in damaged stock.`,
      );
    const movement = await tx.stockMovement.create({
      data: {
        tenantId: ctx.user.tenantId,
        type: "RETURN_TO_COMPANY",
        productId: product.id,
        warehouseId,
        bucket: "DAMAGED",
        quantity: -data.quantity,
        occurredAt: data.returnDate,
        note: data.note ?? `Sent back to ${product.company.name}`,
        requestId: data.requestId,
        createdById: ctx.user.id,
      },
    });
    await writeAudit(tx, ctx.user, {
      action: "POST",
      entityType: "StockMovement",
      entityId: movement.id,
      newValue: movement,
      requestId: data.requestId,
    });
    return movement;
  });
}
