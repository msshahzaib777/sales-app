import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { PurchaseOrderStatus } from "@/generated/prisma/enums";
import { purchaseOrderSchema, type PurchaseOrderInput } from "@/lib/validation/purchasing";
import { recordIdSchema } from "@/lib/validation/master";

import { writeAudit } from "../../audit";
import { assertCan, can } from "../../auth/permissions";
import type { TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";
import { PAGE_SIZE, paged, type ServiceCtx } from "../master/common";
import { found, nextDocumentNumber } from "../posting";
import { purchaseOrderStatus } from "./calc";
import type { DateRange } from "./filters";

// Purchase orders: what was ordered from a company (by phone/online, outside the system). Editable
// until something is received; stock and money only move with goods receipts.

const STATUSES: PurchaseOrderStatus[] = [
  "OPEN",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CLOSED",
  "CANCELLED",
];

export type PurchaseOrderFilters = {
  companyId?: string;
  status?: string;
  q?: string;
  page: number;
} & DateRange;

export async function listPurchaseOrders(ctx: ServiceCtx, f: PurchaseOrderFilters) {
  assertCan(ctx.user.role, "operations.manage");
  const number = f.q && /^\d+$/.test(f.q) ? Number(f.q) : undefined;
  const where: Prisma.PurchaseOrderWhereInput = {
    ...(f.companyId ? { companyId: f.companyId } : {}),
    ...(f.status && STATUSES.includes(f.status as PurchaseOrderStatus)
      ? { status: f.status as PurchaseOrderStatus }
      : {}),
    ...(f.from || f.to
      ? { orderDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
      : {}),
    ...(f.q
      ? number
        ? { number }
        : { company: { name: { contains: f.q, mode: "insensitive" } } }
      : {}),
  };
  const [rows, total] = await Promise.all([
    ctx.db.purchaseOrder.findMany({
      where,
      orderBy: [{ orderDate: "desc" }, { number: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { company: { select: { name: true } }, lines: { select: { quantity: true } } },
    }),
    ctx.db.purchaseOrder.count({ where }),
  ]);
  return paged(
    rows.map(({ lines, ...po }) => ({
      ...po,
      lineCount: lines.length,
      orderedQty: lines.reduce((s, l) => s + l.quantity, 0),
    })),
    total,
    f.page,
  );
}

/** Received quantity per purchase-order line, from posted receipts only. */
async function receivedByLine(tx: Pick<TenantTx, "goodsReceiptLine">, lineIds: string[]) {
  if (lineIds.length === 0) return new Map<string, number>();
  const groups = await tx.goodsReceiptLine.groupBy({
    by: ["purchaseOrderLineId"],
    where: { purchaseOrderLineId: { in: lineIds }, goodsReceipt: { status: "POSTED" } },
    _sum: { quantity: true },
  });
  return new Map(groups.map((g) => [g.purchaseOrderLineId!, g._sum.quantity ?? 0]));
}

/** Purchase order with ordered vs received per line (the variance report for one order). */
export async function getPurchaseOrder(ctx: ServiceCtx, id: string) {
  assertCan(ctx.user.role, "operations.manage");
  const po = found(
    await ctx.db.purchaseOrder.findUnique({
      where: { id },
      include: {
        company: { select: { name: true, paymentTermsDays: true } },
        warehouse: { select: { name: true } },
        lines: {
          include: { product: { select: { code: true, name: true } } },
          orderBy: { product: { code: "asc" } },
        },
        goodsReceipts: {
          orderBy: { receivedDate: "asc" },
          select: { id: true, number: true, receivedDate: true, status: true },
        },
      },
    }),
    "purchase order",
  );
  const received = await receivedByLine(
    ctx.db,
    po.lines.map((l) => l.id),
  );
  const showCost = can(ctx.user.role, "financials.view");
  return {
    ...po,
    lines: po.lines.map(({ rate, ...line }) => {
      const got = received.get(line.id) ?? 0;
      return {
        ...line,
        rate: showCost ? rate : null,
        received: got,
        variance: got - line.quantity,
      };
    }),
    hasReceipts: po.goodsReceipts.some((r) => r.status === "POSTED"),
  };
}

/** Products of the company (active), with rates, for a purchase line. */
async function companyProducts(tx: TenantTx, companyId: string, productIds: string[]) {
  const products = await tx.product.findMany({ where: { id: { in: productIds } } });
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const id of productIds) {
    const p = byId.get(id);
    if (!p || p.companyId !== companyId)
      throw new ServiceError("Every product must belong to the chosen company.");
    if (!p.isActive) throw new ServiceError(`${p.name} is deactivated.`);
  }
  return byId;
}

async function activeCompany(tx: TenantTx, companyId: string) {
  const company = await tx.company.findUnique({ where: { id: companyId } });
  if (!company || !company.isActive) throw new ServiceError("Choose an active company.");
  return company;
}

/** Line rates: what the user typed if they may see cost, otherwise the product's purchase rate. */
async function lineData(tx: TenantTx, ctx: ServiceCtx, input: PurchaseOrderInput) {
  const products = await companyProducts(
    tx,
    input.companyId,
    input.lines.map((l) => l.productId),
  );
  const showCost = can(ctx.user.role, "financials.view");
  return input.lines.map((l) => ({
    tenantId: ctx.user.tenantId,
    productId: l.productId,
    quantity: l.quantity,
    rate: showCost && l.rate !== null ? l.rate : products.get(l.productId)!.purchaseRate,
  }));
}

export async function createPurchaseOrder(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "operations.manage");
  const data = purchaseOrderSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    if (data.requestId) {
      const existing = await tx.purchaseOrder.findUnique({
        where: { tenantId_requestId: { tenantId: ctx.user.tenantId, requestId: data.requestId } },
      });
      if (existing) return existing;
    }
    const company = await activeCompany(tx, data.companyId);
    const lines = await lineData(tx, ctx, data);
    const po = await tx.purchaseOrder.create({
      data: {
        tenantId: ctx.user.tenantId,
        number: await nextDocumentNumber(tx, ctx, "PURCHASE_ORDER"),
        companyId: company.id,
        warehouseId: company.warehouseId,
        orderDate: data.orderDate,
        expectedDate: data.expectedDate,
        note: data.note,
        requestId: data.requestId,
        createdById: ctx.user.id,
        lines: { create: lines.map(({ tenantId: _t, ...l }) => l) },
      },
    });
    await writeAudit(tx, ctx.user, {
      action: "CREATE",
      entityType: "PurchaseOrder",
      entityId: po.id,
      newValue: {
        ...po,
        lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      },
      requestId: data.requestId,
    });
    return po;
  });
}

async function editablePurchaseOrder(tx: TenantTx, id: string) {
  const po = found(
    await tx.purchaseOrder.findUnique({ where: { id }, include: { lines: true } }),
    "purchase order",
  );
  const receipts = await tx.goodsReceipt.count({
    where: { purchaseOrderId: id, status: "POSTED" },
  });
  if (po.status !== "OPEN" || receipts > 0) {
    throw new ServiceError("Only open purchase orders with nothing received can be changed.");
  }
  return po;
}

export async function updatePurchaseOrder(ctx: ServiceCtx, id: string, input: unknown) {
  assertCan(ctx.user.role, "operations.manage");
  const data = purchaseOrderSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const before = await editablePurchaseOrder(tx, id);
    if (before.companyId !== data.companyId)
      throw new ServiceError("The company of a purchase order cannot change.");
    const lines = await lineData(tx, ctx, data);
    await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
    await tx.purchaseOrderLine.createMany({
      data: lines.map((l) => ({ ...l, purchaseOrderId: id })),
    });
    const after = await tx.purchaseOrder.update({
      where: { id },
      data: { orderDate: data.orderDate, expectedDate: data.expectedDate, note: data.note },
    });
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "PurchaseOrder",
      entityId: id,
      oldValue: {
        lines: before.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
      },
      newValue: {
        lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
        orderDate: after.orderDate,
      },
    });
    return after;
  });
}

/** Cancel (nothing received yet) or close (stop waiting for the rest). */
export async function setPurchaseOrderStatus(
  ctx: ServiceCtx,
  input: unknown,
  target: "CANCELLED" | "CLOSED",
) {
  assertCan(ctx.user.role, "operations.manage");
  const { id } = recordIdSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const po = found(await tx.purchaseOrder.findUnique({ where: { id } }), "purchase order");
    if (target === "CANCELLED") await editablePurchaseOrder(tx, id);
    if (target === "CLOSED" && po.status !== "PARTIALLY_RECEIVED") {
      throw new ServiceError("Only a partly received purchase order can be closed.");
    }
    const after = await tx.purchaseOrder.update({ where: { id }, data: { status: target } });
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "PurchaseOrder",
      entityId: id,
      oldValue: { status: po.status },
      newValue: { status: target },
    });
    return after;
  });
}

/** Recomputes a purchase order's status after a receipt is posted or cancelled. */
export async function refreshPurchaseOrderStatus(tx: TenantTx, purchaseOrderId: string) {
  const po = await tx.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
    include: { lines: true },
  });
  const received = await receivedByLine(
    tx,
    po.lines.map((l) => l.id),
  );
  const current =
    po.status === "RECEIVED" || po.status === "PARTIALLY_RECEIVED" ? "OPEN" : po.status;
  const status = purchaseOrderStatus(
    current,
    po.lines.map((l) => ({ ordered: l.quantity, received: received.get(l.id) ?? 0 })),
  );
  if (status !== po.status)
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { status } });
  return status;
}

/** Open purchase orders of a company, for the receipt form. */
export function openPurchaseOrders(ctx: ServiceCtx) {
  return ctx.db.purchaseOrder.findMany({
    where: { status: { in: ["OPEN", "PARTIALLY_RECEIVED"] } },
    orderBy: [{ orderDate: "asc" }, { number: "asc" }],
    select: { id: true, number: true, companyId: true, orderDate: true },
  });
}

/** Active products for purchase forms; purchase rates only for roles that may see cost. */
export async function productsForPurchasing(ctx: ServiceCtx) {
  assertCan(ctx.user.role, "operations.manage");
  const showCost = can(ctx.user.role, "financials.view");
  const products = await ctx.db.product.findMany({
    where: { isActive: true },
    orderBy: [{ code: "asc" }],
    select: { id: true, code: true, name: true, companyId: true, purchaseRate: true },
  });
  return products.map((p) => ({ ...p, purchaseRate: showCost ? p.purchaseRate.toFixed(2) : null }));
}
