import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { TripStatus } from "@/generated/prisma/enums";
import { byRoute, loadByProduct, takeFromBatches } from "@/lib/delivery";
import { formatDozens } from "@/lib/units";
import { recordIdSchema } from "@/lib/validation/master";
import { tripOrderSchema, tripOrdersSchema, tripSchema } from "@/lib/validation/delivery";

import { writeAudit } from "../../audit";
import { assertCan } from "../../auth/permissions";
import type { TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";
import { PAGE_SIZE, paged, type ServiceCtx } from "../master/common";
import { batchBalances, found, nextDocumentNumber } from "../posting";
import type { DateRange } from "../purchasing/filters";
import type { FrozenPrevious } from "../sales/bills";
import { customerPending } from "../sales/positions";

// Delivery trips (SPEC §7, Phase 1): staff put a day's booked orders on a bike with a driver (the
// orders become Planned), print the loading sheet and bills, then dispatch. Dispatch, in one
// transaction:
//  - takes the stock out (oldest batches first) and refuses if the warehouse is short;
//  - posts each bill to the customer ledger, one entry per company slice, and freezes its
//    "previous pending" (overall and per company) for printing;
//  - marks the orders Dispatched.
// Load suggestions, drag-and-drop planning and stop order come in Phase 2.

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

/** The bike, the driver and the orders for a new trip, all checked. */
async function checkTripParts(
  tx: TenantTx,
  input: { tripDate: Date; bikeId: string; driverId: string; orderIds: string[] },
  tripWarehouseId?: string,
) {
  const [bike, driver, orders] = await Promise.all([
    tx.bike.findUnique({ where: { id: input.bikeId } }),
    tx.staff.findUnique({ where: { id: input.driverId } }),
    tx.salesOrder.findMany({
      where: { id: { in: input.orderIds } },
      select: { id: true, number: true, status: true, deliveryDate: true, warehouseId: true },
    }),
  ]);
  if (!bike || !bike.isActive) throw new ServiceError("Choose an active bike.");
  if (!driver || !driver.isActive) throw new ServiceError("Choose an active driver.");
  if (orders.length !== input.orderIds.length)
    throw new ServiceError("Some of the ticked orders were not found. Reload the page.");
  for (const o of orders) {
    if (o.status !== "BOOKED")
      throw new ServiceError(
        `Order #${o.number} is not waiting for delivery (it may already be on a trip).`,
      );
    if (o.deliveryDate.getTime() !== input.tripDate.getTime())
      throw new ServiceError(`Order #${o.number} is for another delivery date.`);
  }
  const warehouseId = tripWarehouseId ?? bike.warehouseId ?? orders[0]?.warehouseId;
  const elsewhere = orders.find((o) => o.warehouseId !== warehouseId);
  if (elsewhere)
    throw new ServiceError(
      `Order #${elsewhere.number} is delivered from another warehouse than this bike's.`,
    );
  return { bike, driver, orders, warehouseId: warehouseId! };
}

export async function createTrip(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "operations.manage");
  const data = tripSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    if (data.requestId) {
      const existing = await tx.deliveryTrip.findUnique({
        where: { tenantId_requestId: { tenantId: ctx.user.tenantId, requestId: data.requestId } },
      });
      if (existing) return existing;
    }
    const { warehouseId } = await checkTripParts(tx, data);
    const trip = await tx.deliveryTrip.create({
      data: {
        tenantId: ctx.user.tenantId,
        number: await nextDocumentNumber(tx, ctx, "DELIVERY_TRIP"),
        tripDate: data.tripDate,
        warehouseId,
        bikeId: data.bikeId,
        driverId: data.driverId,
        note: data.note,
        requestId: data.requestId,
        createdById: ctx.user.id,
      },
    });
    await planOrders(tx, trip.id, data.orderIds);
    await writeAudit(tx, ctx.user, {
      action: "CREATE",
      entityType: "DeliveryTrip",
      entityId: trip.id,
      newValue: { ...trip, orderIds: data.orderIds },
      requestId: data.requestId,
    });
    return trip;
  });
}

/** Booked → Planned on this trip. The status condition stops two trips taking the same order. */
async function planOrders(tx: TenantTx, tripId: string, orderIds: string[]) {
  const { count } = await tx.salesOrder.updateMany({
    where: { id: { in: orderIds }, status: "BOOKED" },
    data: { status: "PLANNED", tripId },
  });
  if (count !== orderIds.length)
    throw new ServiceError("Some orders were just put on another trip. Reload the page.");
}

async function plannedTrip(tx: TenantTx, id: string) {
  const trip = found(await tx.deliveryTrip.findUnique({ where: { id } }), "trip");
  if (trip.status !== "PLANNED")
    throw new ServiceError("This trip has already left; its orders can no longer change.");
  return trip;
}

export async function addOrdersToTrip(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "operations.manage");
  const data = tripOrdersSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const trip = await plannedTrip(tx, data.tripId);
    await checkTripParts(tx, { ...trip, orderIds: data.orderIds }, trip.warehouseId);
    await planOrders(tx, trip.id, data.orderIds);
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "DeliveryTrip",
      entityId: trip.id,
      newValue: { addedOrderIds: data.orderIds },
    });
  });
}

export async function removeOrderFromTrip(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "operations.manage");
  const data = tripOrderSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const trip = await plannedTrip(tx, data.tripId);
    const { count } = await tx.salesOrder.updateMany({
      where: { id: data.orderId, tripId: trip.id, status: "PLANNED" },
      data: { status: "BOOKED", tripId: null },
    });
    if (count === 0) throw new ServiceError("This order is not on this trip.");
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "DeliveryTrip",
      entityId: trip.id,
      newValue: { removedOrderId: data.orderId },
    });
  });
}

/** Calls off a planned trip; its orders go back to booked. */
export async function cancelTrip(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "operations.manage");
  const { id } = recordIdSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const trip = await plannedTrip(tx, id);
    await tx.salesOrder.updateMany({
      where: { tripId: id, status: "PLANNED" },
      data: { status: "BOOKED", tripId: null },
    });
    await tx.deliveryTrip.update({ where: { id }, data: { status: "CANCELLED" } });
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "DeliveryTrip",
      entityId: id,
      oldValue: { status: trip.status },
      newValue: { status: "CANCELLED" },
    });
  });
}

// ───────────────────────── Dispatch ─────────────────────────

/** Saleable stock movements out of the warehouse for one line, oldest batches first. */
async function stockOut(
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

export async function dispatchTrip(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "operations.manage");
  const { id } = recordIdSchema.parse(input);
  return ctx.db.$transaction(
    async (tx) => {
      const trip = await plannedTrip(tx, id);
      const orders = await tx.salesOrder.findMany({
        where: { tripId: id, status: "PLANNED" },
        orderBy: { number: "asc" },
        include: { lines: { include: { product: { select: { name: true } } } }, bill: true },
      });
      if (orders.length === 0) throw new ServiceError("Add at least one order before dispatch.");
      const waiting = orders.filter((o) => o.needsCreditApproval);
      if (waiting.length > 0)
        throw new ServiceError(
          `Order ${waiting.map((o) => `#${o.number}`).join(", ")} ${waiting.length === 1 ? "waits" : "wait"} for the owner to allow it past the credit limit. Approve or remove ${waiting.length === 1 ? "it" : "them"} first.`,
        );

      // Enough stock on hand for the whole load?
      const allLines = orders.flatMap((o) => o.lines);
      const load = loadByProduct(allLines);
      const onHand = await tx.stockMovement.groupBy({
        by: ["productId"],
        where: {
          warehouseId: trip.warehouseId,
          bucket: "SALEABLE",
          productId: { in: [...load.keys()] },
        },
        _sum: { quantity: true },
      });
      const have = new Map(onHand.map((g) => [g.productId, g._sum.quantity ?? 0]));
      const names = new Map(allLines.map((l) => [l.productId, l.product.name]));
      const short = [...load]
        .filter(([pid, qty]) => qty > (have.get(pid) ?? 0))
        .map(
          ([pid, qty]) =>
            `${names.get(pid)} (needs ${formatDozens(qty)}, ${formatDozens(Math.max(have.get(pid) ?? 0, 0))} on hand)`,
        );
      if (short.length > 0)
        throw new ServiceError(`Not enough stock to dispatch: ${short.join("; ")}.`);

      // Claim the trip first, so a double click cannot dispatch it twice.
      const claimed = await tx.deliveryTrip.updateMany({
        where: { id, status: "PLANNED" },
        data: { status: "DISPATCHED", dispatchedAt: new Date() },
      });
      if (claimed.count === 0) throw new ServiceError("This trip was already dispatched.");

      const batchLeft = new Map<string, { id: string; available: number }[]>();
      for (const order of orders) {
        for (const line of order.lines) {
          await stockOut(
            tx,
            ctx,
            {
              productId: line.productId,
              warehouseId: trip.warehouseId,
              quantity: line.quantity,
              orderId: order.id,
              at: trip.tripDate,
            },
            batchLeft,
          );
        }
        const bill = order.bill!;
        const pending = await customerPending(tx, order.customerId);
        const frozen: FrozenPrevious = [...pending.byCompany]
          .filter(([, v]) => !v.isZero())
          .map(([companyId, amount]) => ({ companyId, amount: amount.toFixed(2) }));
        await tx.bill.update({
          where: { id: bill.id },
          data: {
            postedAt: new Date(),
            billDate: trip.tripDate,
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
              entryDate: trip.tripDate,
              debit: amount,
              description: `Bill #${bill.number} (order #${order.number})`,
              referenceType: "Bill",
              referenceId: bill.id,
              createdById: ctx.user.id,
            },
          });
        }
        await tx.salesOrder.update({ where: { id: order.id }, data: { status: "DISPATCHED" } });
      }
      await writeAudit(tx, ctx.user, {
        action: "POST",
        entityType: "DeliveryTrip",
        entityId: id,
        oldValue: { status: "PLANNED" },
        newValue: {
          status: "DISPATCHED",
          orders: orders.map((o) => ({ id: o.id, number: o.number, bill: o.bill?.netAmount })),
          load: Object.fromEntries(load),
        },
      });
      return { orders: orders.length };
    },
    // Serializable: two trips dispatched at once must not both take the same stock.
    { timeout: 60_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

// ───────────────────────── Reading ─────────────────────────

const TRIP_STATUSES: TripStatus[] = ["PLANNED", "DISPATCHED", "RECONCILED", "CANCELLED"];

export async function listTrips(
  ctx: ServiceCtx,
  f: { status?: string; q?: string; page: number } & DateRange,
) {
  assertCan(ctx.user.role, "operations.manage");
  const where: Prisma.DeliveryTripWhereInput = {
    ...(f.q
      ? /^\d+$/.test(f.q)
        ? { number: Number(f.q) }
        : {
            OR: [
              { bike: { name: { contains: f.q, mode: "insensitive" } } },
              { driver: { name: { contains: f.q, mode: "insensitive" } } },
            ],
          }
      : {}),
    ...(f.status === "open"
      ? { status: { in: ["PLANNED", "DISPATCHED"] } }
      : f.status && TRIP_STATUSES.includes(f.status as TripStatus)
        ? { status: f.status as TripStatus }
        : {}),
    ...(f.from || f.to
      ? { tripDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
      : {}),
  };
  const [rows, total] = await Promise.all([
    ctx.db.deliveryTrip.findMany({
      where,
      orderBy: [{ tripDate: "desc" }, { number: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        bike: { select: { name: true, capacity: true } },
        driver: { select: { name: true } },
        orders: {
          select: {
            reconciledAt: true,
            bill: { select: { netAmount: true } },
            lines: { select: { quantity: true } },
          },
        },
      },
    }),
    ctx.db.deliveryTrip.count({ where }),
  ]);
  return paged(
    rows.map(({ orders, ...t }) => ({
      ...t,
      orderCount: orders.length,
      reconciledCount: orders.filter((o) => o.reconciledAt).length,
      load: orders.reduce((s, o) => s + o.lines.reduce((a, l) => a + l.quantity, 0), 0),
      billTotal: orders.reduce((s, o) => s.add(o.bill?.netAmount ?? 0), D(0)),
    })),
    total,
    f.page,
  );
}

export async function getTrip(ctx: ServiceCtx, id: string) {
  assertCan(ctx.user.role, "operations.manage");
  const trip = found(
    await ctx.db.deliveryTrip.findUnique({
      where: { id },
      include: {
        warehouse: { select: { name: true } },
        bike: { select: { name: true, capacity: true } },
        driver: { select: { name: true, phone: true } },
        orders: {
          include: {
            customer: {
              select: {
                name: true,
                shopName: true,
                address: true,
                phone: true,
                routeSequence: true,
                area: { select: { name: true, sortOrder: true } },
              },
            },
            bill: { select: { id: true, number: true, netAmount: true, previousBalance: true } },
            lines: {
              include: {
                product: { select: { code: true, name: true } },
                company: { select: { name: true } },
              },
            },
            payments: {
              where: { status: "POSTED" },
              select: { method: true, amount: true },
            },
          },
        },
      },
    }),
    "trip",
  );
  // Stops: by area (route order), then customer.
  const orders = [...trip.orders]
    .filter((o) => o.status !== "CANCELLED")
    .sort(byRoute)
    .map((o) => {
      const collected = { CASH: D(0), CHEQUE: D(0), ONLINE: D(0) };
      for (const p of o.payments) collected[p.method] = collected[p.method].add(p.amount);
      return {
        ...o,
        quantity: o.lines.reduce((s, l) => s + l.quantity, 0),
        delivered: o.lines.reduce(
          (s, l) => s + l.quantity - l.returnedQuantity - l.damagedQuantity,
          0,
        ),
        collected,
      };
    });

  // Loading sheet: product totals, by company.
  const products = new Map<
    string,
    { productId: string; code: string; name: string; companyName: string; quantity: number }
  >();
  for (const l of orders.flatMap((o) => o.lines)) {
    const p = products.get(l.productId) ?? {
      productId: l.productId,
      code: l.product.code,
      name: l.product.name,
      companyName: l.company.name,
      quantity: 0,
    };
    p.quantity += l.quantity;
    products.set(l.productId, p);
  }
  const load = [...products.values()].sort(
    (a, b) => a.companyName.localeCompare(b.companyName) || a.code.localeCompare(b.code),
  );
  const totals = {
    load: load.reduce((s, p) => s + p.quantity, 0),
    bills: orders.reduce((s, o) => s.add(o.bill?.netAmount ?? 0), D(0)),
    cash: orders.reduce((s, o) => s.add(o.collected.CASH), D(0)),
    cheque: orders.reduce((s, o) => s.add(o.collected.CHEQUE), D(0)),
    online: orders.reduce((s, o) => s.add(o.collected.ONLINE), D(0)),
  };
  return { ...trip, orders, load, totals };
}

export type TripView = Awaited<ReturnType<typeof getTrip>>;

/** Booked orders for a delivery date (optionally one warehouse), for planning a trip. */
export async function bookedOrdersFor(ctx: ServiceCtx, date: Date, warehouseId?: string) {
  assertCan(ctx.user.role, "operations.manage");
  const rows = await ctx.db.salesOrder.findMany({
    where: { status: "BOOKED", deliveryDate: date, ...(warehouseId ? { warehouseId } : {}) },
    include: {
      customer: {
        select: {
          name: true,
          shopName: true,
          routeSequence: true,
          area: { select: { name: true, sortOrder: true } },
        },
      },
      warehouse: { select: { name: true } },
      bill: { select: { netAmount: true } },
      lines: { select: { quantity: true } },
    },
  });
  return rows
    .map((o) => ({
      id: o.id,
      number: o.number,
      warehouseId: o.warehouseId,
      warehouseName: o.warehouse.name,
      customerName: o.customer.name,
      shopName: o.customer.shopName,
      areaName: o.customer.area?.name ?? null,
      areaSort: o.customer.area?.sortOrder ?? 999,
      routeSequence: o.customer.routeSequence,
      needsCreditApproval: o.needsCreditApproval,
      quantity: o.lines.reduce((s, l) => s + l.quantity, 0),
      amount: o.bill?.netAmount ?? D(0),
    }))
    .sort(
      (a, b) =>
        a.warehouseName.localeCompare(b.warehouseName) ||
        a.areaSort - b.areaSort ||
        (a.areaName ?? "").localeCompare(b.areaName ?? "") ||
        (a.routeSequence ?? 9999) - (b.routeSequence ?? 9999) ||
        a.customerName.localeCompare(b.customerName),
    );
}

/** Active bikes (with their usual driver) and staff who can drive, for the trip form. */
export async function tripFormOptions(ctx: ServiceCtx) {
  assertCan(ctx.user.role, "operations.manage");
  const [bikes, staff] = await Promise.all([
    ctx.db.bike.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        capacity: true,
        driverId: true,
        warehouse: { select: { id: true, name: true } },
      },
    }),
    ctx.db.staff.findMany({
      where: { isActive: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: { id: true, name: true, role: true },
    }),
  ]);
  return { bikes, staff };
}
