import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { SalesOrderStatus } from "@/generated/prisma/enums";
import { formatMoney } from "@/lib/format";
import type { DiscountType } from "@/lib/pricing";
import {
  billTotals,
  checkCredit,
  type CreditCheck,
  isOpenOrder,
  priceLine,
  type PricedLine,
} from "@/lib/sales";
import { recordIdSchema } from "@/lib/validation/master";
import { salesOrderSchema, type SalesOrderInput } from "@/lib/validation/sales";

import { writeAudit } from "../../audit";
import { assertCan, can } from "../../auth/permissions";
import type { TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";
import { PAGE_SIZE, paged, type ServiceCtx } from "../master/common";
import { found, nextDocumentNumber } from "../posting";
import type { DateRange } from "../purchasing/filters";
import { customerPending, openOrdersTotal, stockPositions } from "./positions";

// Sales orders (SPEC §6). Booking an order, in one transaction:
//  - prices every line from the product (sale rate, company discount or the slab reached);
//  - checks the customer's credit limit (pending + other open orders + this order);
//  - creates the order and its bill (one bill per order, any number of companies) and a bill
//    revision, so every version of the bill is kept.
// Booked and planned orders reserve stock; nothing is posted to the stock or money journals until
// dispatch (Task 8), so edits and cancellations before dispatch touch no journal.

const money = (v: Prisma.Decimal | { toString(): string }) => new Prisma.Decimal(v.toString());

export type OrderResult = {
  id: string;
  number: number;
  credit: CreditCheck;
  needsCreditApproval: boolean;
  /** Products booked beyond available stock (stock may still arrive before dispatch). */
  shortages: { productId: string; name: string; short: number }[];
};

async function loadProducts(tx: TenantTx, warehouseId: string, productIds: string[]) {
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    include: { company: { select: { warehouseId: true, name: true } }, discountTiers: true },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const id of productIds) {
    const p = byId.get(id);
    if (!p) throw new ServiceError("A product on this order was not found.");
    if (!p.isActive) throw new ServiceError(`${p.name} is deactivated.`);
    if (p.company.warehouseId !== warehouseId) {
      throw new ServiceError(`${p.name} is not stocked in the customer's warehouse.`);
    }
  }
  return byId;
}

function priceLines(
  products: Awaited<ReturnType<typeof loadProducts>>,
  input: SalesOrderInput,
): PricedLine[] {
  return input.lines.map((line) => {
    const p = products.get(line.productId)!;
    return priceLine(
      {
        id: p.id,
        companyId: p.companyId,
        saleRate: p.saleRate.toString(),
        discountType: p.discountType as DiscountType,
        discountValue: p.discountValue.toString(),
        tiers: p.discountTiers.map((t) => ({
          minQuantity: t.minQuantity,
          discountType: t.discountType as DiscountType,
          discountValue: t.discountValue.toString(),
        })),
      },
      line.quantity,
    );
  });
}

/** The warehouse comes from the customer's area; customers without an area must name one. */
async function orderWarehouse(
  tx: TenantTx,
  customer: { areaId: string | null },
  requested: string | null,
) {
  if (customer.areaId) {
    const area = await tx.area.findUniqueOrThrow({ where: { id: customer.areaId } });
    return area.warehouseId;
  }
  if (!requested)
    throw new ServiceError("This customer has no area. Choose the warehouse to deliver from.");
  const warehouse = await tx.warehouse.findUnique({ where: { id: requested } });
  if (!warehouse || !warehouse.isActive) throw new ServiceError("Choose an active warehouse.");
  return warehouse.id;
}

/** Bill revision rows: an immutable snapshot of what the bill says at this point. */
async function writeBillRevision(
  tx: TenantTx,
  ctx: ServiceCtx,
  billId: string,
  revision: number,
  reason: string,
  lines: PricedLine[],
) {
  const { total, byCompany } = billTotals(lines);
  await tx.billRevision.create({
    data: {
      tenantId: ctx.user.tenantId,
      billId,
      revision,
      reason,
      grossAmount: money(total.grossAmount),
      discountAmount: money(total.discountAmount),
      taxAmount: money(total.taxAmount),
      netAmount: money(total.netAmount),
      lines: lines.map((l) => ({
        productId: l.productId,
        companyId: l.companyId,
        quantity: l.quantity,
        rate: l.rate.toFixed(2),
        discountType: l.discountType,
        discountValue: l.discountValue.toFixed(2),
        grossAmount: l.grossAmount.toFixed(2),
        discountAmount: l.discountAmount.toFixed(2),
        taxAmount: l.taxAmount.toFixed(2),
        netAmount: l.netAmount.toFixed(2),
      })),
      companyTotals: [...byCompany].map(([companyId, t]) => ({
        companyId,
        netAmount: t.netAmount.toFixed(2),
        quantity: t.quantity,
      })),
      createdById: ctx.user.id,
    },
  });
}

const lineRows = (ctx: ServiceCtx, lines: PricedLine[]) =>
  lines.map((l) => ({
    tenantId: ctx.user.tenantId,
    productId: l.productId,
    companyId: l.companyId,
    quantity: l.quantity,
    rate: money(l.rate),
    discountType: l.discountType,
    discountValue: money(l.discountValue),
    grossAmount: money(l.grossAmount),
    discountAmount: money(l.discountAmount),
    taxAmount: money(l.taxAmount),
    netAmount: money(l.netAmount),
  }));

/** Credit decision: allowed by the owner, waiting for the owner, or (owner, not ticked) refused. */
function creditDecision(ctx: ServiceCtx, credit: CreditCheck, allowOverCredit: boolean) {
  if (!credit.over) return { needsCreditApproval: false, override: false };
  if (can(ctx.user.role, "orders.overrideCreditLimit")) {
    if (!allowOverCredit) {
      throw new ServiceError(
        `This order takes the customer ${formatMoney(credit.over)} past their credit limit of ${formatMoney(credit.limit)}. Tick "Allow past the credit limit" to book it anyway.`,
      );
    }
    return { needsCreditApproval: false, override: true };
  }
  return { needsCreditApproval: true, override: false };
}

async function shortages(
  tx: TenantTx,
  warehouseId: string,
  lines: PricedLine[],
  names: Map<string, string>,
  excludeOrderId?: string,
) {
  const positions = await stockPositions(
    tx,
    warehouseId,
    lines.map((l) => l.productId),
    excludeOrderId,
  );
  return lines
    .map((l) => ({
      productId: l.productId,
      name: names.get(l.productId)!,
      short: l.quantity - (positions.get(l.productId)?.available ?? 0),
    }))
    .filter((s) => s.short > 0);
}

export async function createSalesOrder(ctx: ServiceCtx, input: unknown): Promise<OrderResult> {
  assertCan(ctx.user.role, "operations.manage");
  const data = salesOrderSchema.parse(input);
  return ctx.db.$transaction(
    async (tx) => {
      if (data.requestId) {
        const existing = await tx.salesOrder.findUnique({
          where: { tenantId_requestId: { tenantId: ctx.user.tenantId, requestId: data.requestId } },
          include: { bill: true },
        });
        if (existing) {
          const credit = checkCredit({
            creditLimit: null,
            pending: 0,
            openOrders: 0,
            thisOrder: existing.bill?.netAmount.toString() ?? 0,
          });
          return {
            id: existing.id,
            number: existing.number,
            credit,
            needsCreditApproval: existing.needsCreditApproval,
            shortages: [],
          };
        }
      }
      const customer = await tx.customer.findUnique({ where: { id: data.customerId } });
      if (!customer || !customer.isActive) throw new ServiceError("Choose an active customer.");
      const warehouseId = await orderWarehouse(tx, customer, data.warehouseId);
      const products = await loadProducts(
        tx,
        warehouseId,
        data.lines.map((l) => l.productId),
      );
      const lines = priceLines(products, data);
      const { total, byCompany } = billTotals(lines);

      const pending = await customerPending(tx, customer.id);
      const credit = checkCredit({
        creditLimit: customer.creditLimit?.toString() ?? null,
        pending: pending.total.toString(),
        openOrders: (await openOrdersTotal(tx, customer.id)).toString(),
        thisOrder: total.netAmount,
      });
      const decision = creditDecision(ctx, credit, data.allowOverCredit);

      const order = await tx.salesOrder.create({
        data: {
          tenantId: ctx.user.tenantId,
          number: await nextDocumentNumber(tx, ctx, "SALES_ORDER"),
          customerId: customer.id,
          warehouseId,
          orderDate: data.orderDate,
          deliveryDate: data.deliveryDate,
          source: data.source,
          note: data.note,
          requestId: data.requestId,
          needsCreditApproval: decision.needsCreditApproval,
          creditOverrideById: decision.override ? ctx.user.id : null,
          creditOverrideAt: decision.override ? new Date() : null,
          createdById: ctx.user.id,
          lines: { create: lineRows(ctx, lines).map(({ tenantId: _t, ...l }) => l) },
        },
      });
      const bill = await tx.bill.create({
        data: {
          tenantId: ctx.user.tenantId,
          number: await nextDocumentNumber(tx, ctx, "BILL"),
          salesOrderId: order.id,
          customerId: customer.id,
          billDate: data.deliveryDate,
          grossAmount: money(total.grossAmount),
          discountAmount: money(total.discountAmount),
          taxAmount: money(total.taxAmount),
          netAmount: money(total.netAmount),
          previousBalance: pending.total,
        },
      });
      await writeBillRevision(tx, ctx, bill.id, 1, "Booked", lines);
      await writeAudit(tx, ctx.user, {
        action: "CREATE",
        entityType: "SalesOrder",
        entityId: order.id,
        newValue: {
          number: order.number,
          customerId: customer.id,
          deliveryDate: data.deliveryDate,
          lines: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            netAmount: l.netAmount,
          })),
          total: total.netAmount,
          companies: [...byCompany.keys()],
          credit: credit.over
            ? { over: credit.over, overrideBy: decision.override ? ctx.user.id : null }
            : null,
        },
        requestId: data.requestId,
      });
      const names = new Map([...products.values()].map((p) => [p.id, p.name]));
      return {
        id: order.id,
        number: order.number,
        credit,
        needsCreditApproval: decision.needsCreditApproval,
        shortages: await shortages(tx, warehouseId, lines, names, order.id),
      };
    },
    { timeout: 30_000 },
  );
}

/** Edits a booked or planned order (until dispatch). Every edit adds a bill revision and is audited. */
export async function updateSalesOrder(
  ctx: ServiceCtx,
  id: string,
  input: unknown,
): Promise<OrderResult> {
  assertCan(ctx.user.role, "operations.manage");
  const data = salesOrderSchema.parse(input);
  return ctx.db.$transaction(
    async (tx) => {
      const before = found(
        await tx.salesOrder.findUnique({ where: { id }, include: { lines: true, bill: true } }),
        "order",
      );
      if (!isOpenOrder(before.status))
        throw new ServiceError(
          "Only booked or planned orders can be changed. After dispatch, use day-end entry.",
        );
      if (before.customerId !== data.customerId)
        throw new ServiceError(
          "The customer of an order cannot change. Cancel it and book a new one.",
        );
      const products = await loadProducts(
        tx,
        before.warehouseId,
        data.lines.map((l) => l.productId),
      );
      const lines = priceLines(products, data);
      const { total } = billTotals(lines);

      const customer = await tx.customer.findUniqueOrThrow({ where: { id: before.customerId } });
      const pending = await customerPending(tx, customer.id);
      const credit = checkCredit({
        creditLimit: customer.creditLimit?.toString() ?? null,
        pending: pending.total.toString(),
        openOrders: (await openOrdersTotal(tx, customer.id, id)).toString(),
        thisOrder: total.netAmount,
      });
      const decision = creditDecision(ctx, credit, data.allowOverCredit);

      await tx.salesOrderLine.deleteMany({ where: { salesOrderId: id } });
      await tx.salesOrderLine.createMany({
        data: lineRows(ctx, lines).map((l) => ({ ...l, salesOrderId: id })),
      });
      const after = await tx.salesOrder.update({
        where: { id },
        data: {
          orderDate: data.orderDate,
          deliveryDate: data.deliveryDate,
          source: data.source,
          note: data.note,
          needsCreditApproval: decision.needsCreditApproval,
          creditOverrideById: decision.override ? ctx.user.id : null,
          creditOverrideAt: decision.override ? new Date() : null,
        },
      });
      const bill = before.bill!;
      const revision = bill.currentRevision + 1;
      await tx.bill.update({
        where: { id: bill.id },
        data: {
          billDate: data.deliveryDate,
          currentRevision: revision,
          grossAmount: money(total.grossAmount),
          discountAmount: money(total.discountAmount),
          taxAmount: money(total.taxAmount),
          netAmount: money(total.netAmount),
          previousBalance: pending.total,
        },
      });
      await writeBillRevision(tx, ctx, bill.id, revision, "Edited before dispatch", lines);
      await writeAudit(tx, ctx.user, {
        action: "UPDATE",
        entityType: "SalesOrder",
        entityId: id,
        oldValue: {
          deliveryDate: before.deliveryDate,
          lines: before.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          total: bill.netAmount,
        },
        newValue: {
          deliveryDate: after.deliveryDate,
          lines: lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          total: total.netAmount,
        },
      });
      const names = new Map([...products.values()].map((p) => [p.id, p.name]));
      return {
        id,
        number: after.number,
        credit,
        needsCreditApproval: decision.needsCreditApproval,
        shortages: await shortages(tx, before.warehouseId, lines, names, id),
      };
    },
    { timeout: 30_000 },
  );
}

export async function cancelSalesOrder(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "operations.manage");
  const { id } = recordIdSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const order = found(
      await tx.salesOrder.findUnique({ where: { id }, include: { bill: true } }),
      "order",
    );
    if (!isOpenOrder(order.status))
      throw new ServiceError("Only booked or planned orders can be cancelled.");
    const after = await tx.salesOrder.update({
      where: { id },
      data: { status: "CANCELLED", needsCreditApproval: false },
    });
    // The bill was never posted (that happens at dispatch), so cancelling it touches no ledger.
    if (order.bill)
      await tx.bill.update({ where: { id: order.bill.id }, data: { status: "REVERSED" } });
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "SalesOrder",
      entityId: id,
      oldValue: { status: order.status },
      newValue: { status: "CANCELLED" },
    });
    return after;
  });
}

/** Owner allows an order that was booked past the customer's credit limit. */
export async function approveCreditOverride(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "orders.overrideCreditLimit");
  const { id } = recordIdSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const order = found(await tx.salesOrder.findUnique({ where: { id } }), "order");
    if (!order.needsCreditApproval) throw new ServiceError("This order does not need approval.");
    const after = await tx.salesOrder.update({
      where: { id },
      data: {
        needsCreditApproval: false,
        creditOverrideById: ctx.user.id,
        creditOverrideAt: new Date(),
      },
    });
    await writeAudit(tx, ctx.user, {
      action: "APPROVE",
      entityType: "SalesOrder",
      entityId: id,
      newValue: { creditOverride: true },
    });
    return after;
  });
}

// ───────────────────────── Reading ─────────────────────────

export type OrderFilters = {
  q?: string;
  status?: string;
  areaId?: string;
  needsApproval?: boolean;
  page: number;
} & DateRange;

const STATUSES: SalesOrderStatus[] = [
  "BOOKED",
  "PLANNED",
  "DISPATCHED",
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "RETURNED",
  "CANCELLED",
];

/** Orders by delivery date. Status "open" = booked or planned. */
export async function listSalesOrders(ctx: ServiceCtx, f: OrderFilters) {
  assertCan(ctx.user.role, "operations.manage");
  const number = f.q && /^\d+$/.test(f.q) ? Number(f.q) : undefined;
  const where: Prisma.SalesOrderWhereInput = {
    ...(f.status === "open"
      ? { status: { in: ["BOOKED", "PLANNED"] } }
      : f.status && STATUSES.includes(f.status as SalesOrderStatus)
        ? { status: f.status as SalesOrderStatus }
        : {}),
    ...(f.from || f.to
      ? { deliveryDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
      : {}),
    ...(f.areaId ? { customer: { areaId: f.areaId } } : {}),
    ...(f.needsApproval ? { needsCreditApproval: true } : {}),
    ...(f.q
      ? number
        ? { number }
        : {
            customer: {
              OR: [
                { name: { contains: f.q, mode: "insensitive" } },
                { shopName: { contains: f.q, mode: "insensitive" } },
                { phone: { contains: f.q } },
              ],
            },
          }
      : {}),
  };
  const [rows, total, sums] = await Promise.all([
    ctx.db.salesOrder.findMany({
      where,
      orderBy: [{ deliveryDate: "desc" }, { number: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        customer: { select: { name: true, shopName: true, area: { select: { name: true } } } },
        bill: { select: { id: true, number: true, netAmount: true } },
        lines: { select: { quantity: true } },
      },
    }),
    ctx.db.salesOrder.count({ where }),
    ctx.db.bill.aggregate({ where: { salesOrder: where }, _sum: { netAmount: true } }),
  ]);
  return {
    ...paged(
      rows.map(({ lines, ...o }) => ({
        ...o,
        quantity: lines.reduce((s, l) => s + l.quantity, 0),
      })),
      total,
      f.page,
    ),
    totalAmount: sums._sum.netAmount ?? new Prisma.Decimal(0),
  };
}

export async function getSalesOrder(ctx: ServiceCtx, id: string) {
  assertCan(ctx.user.role, "operations.manage");
  const order = found(
    await ctx.db.salesOrder.findUnique({
      where: { id },
      include: {
        customer: { include: { area: { select: { name: true } } } },
        warehouse: { select: { name: true } },
        lines: {
          include: {
            product: { select: { code: true, name: true } },
            company: { select: { name: true } },
          },
          orderBy: [{ company: { name: "asc" } }, { product: { code: "asc" } }],
        },
        bill: {
          include: {
            revisions: {
              orderBy: { revision: "desc" },
              select: { revision: true, reason: true, netAmount: true, createdAt: true },
            },
          },
        },
      },
    }),
    "order",
  );
  const positions = isOpenOrder(order.status)
    ? await stockPositions(
        ctx.db,
        order.warehouseId,
        order.lines.map((l) => l.productId),
        order.id,
      )
    : new Map();
  return {
    ...order,
    lines: order.lines.map((l) => ({
      ...l,
      available: positions.get(l.productId)?.available ?? null,
    })),
  };
}

// ───────────────────────── Order entry screen ─────────────────────────

/** Customers for the picker (name, shop, phone, area). */
export function customersForOrders(ctx: ServiceCtx) {
  assertCan(ctx.user.role, "operations.manage");
  return ctx.db.customer.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      shopName: true,
      phone: true,
      area: { select: { name: true, warehouseId: true } },
    },
  });
}

/**
 * Everything the order screen needs once a customer is chosen: pending (total and per company),
 * credit limit and open orders, the warehouse's products with prices and available stock, and the
 * customer's last order for "repeat last order".
 */
export async function orderEntryContext(
  ctx: ServiceCtx,
  customerId: string,
  opts: { warehouseId?: string; excludeOrderId?: string } = {},
) {
  assertCan(ctx.user.role, "operations.manage");
  const customer = found(
    await ctx.db.customer.findUnique({
      where: { id: customerId },
      include: { area: { select: { name: true, warehouseId: true } } },
    }),
    "customer",
  );
  const warehouseId = customer.area?.warehouseId ?? opts.warehouseId ?? null;
  const [pending, openOrders, companies] = await Promise.all([
    customerPending(ctx.db, customerId),
    openOrdersTotal(ctx.db, customerId, opts.excludeOrderId),
    ctx.db.company.findMany({ select: { id: true, name: true } }),
  ]);
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  let products: {
    id: string;
    code: string;
    name: string;
    companyId: string;
    companyName: string;
    saleRate: string;
    discountType: DiscountType;
    discountValue: string;
    tiers: { minQuantity: number; discountType: DiscountType; discountValue: string }[];
    available: number;
    onHand: number;
  }[] = [];
  if (warehouseId) {
    const rows = await ctx.db.product.findMany({
      where: { isActive: true, company: { warehouseId, isActive: true } },
      include: { discountTiers: { orderBy: { minQuantity: "asc" } } },
      orderBy: { code: "asc" },
    });
    const positions = await stockPositions(ctx.db, warehouseId, undefined, opts.excludeOrderId);
    products = rows.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      companyId: p.companyId,
      companyName: companyName.get(p.companyId) ?? "",
      saleRate: p.saleRate.toFixed(2),
      discountType: p.discountType as DiscountType,
      discountValue: p.discountValue.toFixed(2),
      tiers: p.discountTiers.map((t) => ({
        minQuantity: t.minQuantity,
        discountType: t.discountType as DiscountType,
        discountValue: t.discountValue.toFixed(2),
      })),
      available: positions.get(p.id)?.available ?? 0,
      onHand: positions.get(p.id)?.onHand ?? 0,
    }));
  }

  const last = await ctx.db.salesOrder.findFirst({
    where: {
      customerId,
      status: { not: "CANCELLED" },
      ...(opts.excludeOrderId ? { id: { not: opts.excludeOrderId } } : {}),
    },
    orderBy: [{ orderDate: "desc" }, { number: "desc" }],
    include: { lines: { select: { productId: true, quantity: true } } },
  });

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      shopName: customer.shopName,
      areaName: customer.area?.name ?? null,
      creditLimit: customer.creditLimit?.toFixed(2) ?? null,
      isFlagged: customer.isFlagged,
      flagReason: customer.flagReason,
    },
    warehouseId,
    pending: pending.total.toFixed(2),
    pendingByCompany: [...pending.byCompany]
      .filter(([, v]) => !v.isZero())
      .map(([companyId, v]) => ({
        companyId,
        companyName: companyName.get(companyId) ?? "",
        amount: v.toFixed(2),
      })),
    openOrders: openOrders.toFixed(2),
    products,
    lastOrder: last
      ? {
          number: last.number,
          orderDate: last.orderDate.toISOString().slice(0, 10),
          lines: last.lines,
        }
      : null,
  };
}

export type OrderEntryContext = Awaited<ReturnType<typeof orderEntryContext>>;
