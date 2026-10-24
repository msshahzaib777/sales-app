import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { PaymentMethod } from "@/generated/prisma/enums";
import {
  type BookedLine,
  byRoute,
  checkLineResults,
  deliveredLines,
  deliveryStatus,
  type LineResult,
} from "@/lib/delivery";
import { calculateLineAmounts, type DiscountType } from "@/lib/pricing";
import { billTotals } from "@/lib/sales";
import { formatDozens, HALF_DOZENS_PER_DOZEN } from "@/lib/units";
import { dayEndSchema } from "@/lib/validation/delivery";

import { writeAudit } from "../../audit";
import { assertCan } from "../../auth/permissions";
import type { TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";
import type { ServiceCtx } from "../master/common";
import { postCustomerPayment } from "../payments/customer-payments";
import { found } from "../posting";
import { logClaim } from "../purchasing/claims";
import { customerPending } from "../sales/positions";
import { writeBillRevision } from "../sales/orders";

// Day-end entry (SPEC §7): after the drivers return, staff enter each order from its signed bill.
// One transaction per order:
//  - returned quantity goes back to saleable stock;
//  - damaged quantity goes to damaged stock and becomes a claim against the product's company
//    (at purchase cost, SPEC §17);
//  - the bill is re-priced on what the customer kept, saved as a new revision, and the reduction
//    is credited to each company's slice of the customer ledger;
//  - cash, cheque and online amounts collected become customer payments, split by company;
//  - the order becomes Delivered, Partly delivered or Returned, and the trip is closed once every
//    order on it is entered.
// Phase 2 adds the driver's cash hand-in (short/excess against the driver) on top of this.

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

export async function getDayEndEntry(ctx: ServiceCtx, orderId: string) {
  assertCan(ctx.user.role, "operations.manage");
  const order = found(
    await ctx.db.salesOrder.findUnique({
      where: { id: orderId },
      include: {
        trip: {
          select: {
            id: true,
            number: true,
            tripDate: true,
            status: true,
            bike: { select: { name: true } },
            driver: { select: { name: true } },
          },
        },
        customer: { select: { name: true, shopName: true, area: { select: { name: true } } } },
        bill: { select: { id: true, number: true, netAmount: true, previousBalance: true } },
        lines: {
          include: {
            product: { select: { code: true, name: true } },
            company: { select: { name: true } },
          },
          orderBy: [{ company: { name: "asc" } }, { product: { code: "asc" } }],
        },
        payments: {
          where: { status: "POSTED" },
          include: { cheque: { select: { chequeNo: true, bankName: true } } },
          orderBy: { number: "asc" },
        },
      },
    }),
    "order",
  );
  if (!order.trip) throw new ServiceError("This order did not go out on a trip.");
  const pending = await customerPending(ctx.db, order.customerId);
  return { ...order, trip: order.trip, pendingNow: pending.total };
}

export type DayEndEntry = Awaited<ReturnType<typeof getDayEndEntry>>;

/** The batch this order's stock of a product left from, so returns go back to the same lot. */
async function dispatchBatch(tx: TenantTx, orderId: string, productId: string) {
  const m = await tx.stockMovement.findFirst({
    where: { referenceType: "SalesOrder", referenceId: orderId, productId, type: "DISPATCH" },
    orderBy: { createdAt: "desc" },
    select: { batchId: true },
  });
  return m?.batchId ?? null;
}

export async function saveDayEnd(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "operations.manage");
  const data = dayEndSchema.parse(input);
  return ctx.db.$transaction(
    async (tx) => {
      if (data.requestId) {
        const done = await tx.salesOrder.findUnique({
          where: {
            tenantId_reconcileRequestId: {
              tenantId: ctx.user.tenantId,
              reconcileRequestId: data.requestId,
            },
          },
        });
        if (done)
          return { orderId: done.id, status: done.status, tripId: done.tripId, repeated: true };
      }
      const order = found(
        await tx.salesOrder.findUnique({
          where: { id: data.orderId },
          include: {
            lines: { include: { product: { select: { name: true, purchaseRate: true } } } },
            bill: true,
            trip: true,
          },
        }),
        "order",
      );
      if (order.reconciledAt)
        throw new ServiceError(`Day-end for order #${order.number} is already entered.`);
      if (order.status !== "DISPATCHED" || !order.trip)
        throw new ServiceError(`Order #${order.number} has not been dispatched yet.`);
      const date = order.trip.tripDate;

      const results: LineResult[] = data.lines
        .filter((l) => l.returned > 0 || l.damaged > 0)
        .map((l) => ({
          productId: l.productId,
          returned: l.returned,
          damaged: l.damaged,
        }));
      const names = new Map(order.lines.map((l) => [l.productId, l.product.name]));
      const errors = checkLineResults(order.lines, results, names);
      if (errors.length > 0) throw new ServiceError(errors.join(" "));
      const status = deliveryStatus(order.lines, results);

      // Claim the order first: a second save of the same order (another tab, a retry) stops here.
      const claimed = await tx.salesOrder.updateMany({
        where: { id: order.id, status: "DISPATCHED", reconciledAt: null },
        data: {
          status,
          reconciledAt: new Date(),
          reconciledById: ctx.user.id,
          reconcileRequestId: data.requestId,
        },
      });
      if (claimed.count === 0)
        throw new ServiceError(`Day-end for order #${order.number} is already entered.`);

      // Stock: returns back to saleable stock, damage into damaged stock plus a company claim.
      const claims: {
        number: number;
        productId: string;
        quantity: number;
        amount: Prisma.Decimal;
      }[] = [];
      for (const r of results) {
        const line = order.lines.find((l) => l.productId === r.productId)!;
        await tx.salesOrderLine.update({
          where: { id: line.id },
          data: { returnedQuantity: r.returned, damagedQuantity: r.damaged },
        });
        const batchId = await dispatchBatch(tx, order.id, r.productId);
        const move = (type: "CUSTOMER_RETURN" | "DELIVERY_DAMAGE", quantity: number) =>
          tx.stockMovement.create({
            data: {
              tenantId: ctx.user.tenantId,
              type,
              productId: r.productId,
              warehouseId: order.warehouseId,
              batchId,
              bucket: type === "CUSTOMER_RETURN" ? "SALEABLE" : "DAMAGED",
              quantity,
              occurredAt: date,
              referenceType: "SalesOrder",
              referenceId: order.id,
              createdById: ctx.user.id,
            },
          });
        if (r.returned > 0) await move("CUSTOMER_RETURN", r.returned);
        if (r.damaged > 0) {
          await move("DELIVERY_DAMAGE", r.damaged);
          const rate = line.product.purchaseRate;
          const amount = calculateLineAmounts({
            quantity: r.damaged,
            baseUnitsPerPriceUnit: HALF_DOZENS_PER_DOZEN,
            rate,
          }).netAmount;
          if (amount.gt(0)) {
            const claim = await logClaim(tx, ctx, {
              companyId: line.companyId,
              product: { id: r.productId, name: line.product.name },
              type: "DELIVERY_DAMAGE",
              claimDate: date,
              quantity: r.damaged,
              rate,
              amount: D(amount.toString()),
              note: `damaged in delivery, order #${order.number}`,
              salesOrderId: order.id,
            });
            claims.push({
              number: claim.number,
              productId: r.productId,
              quantity: r.damaged,
              amount: claim.amount,
            });
          }
        }
      }

      // Bill: re-priced on what the customer kept; the reduction is credited per company.
      const bill = order.bill!;
      const booked: BookedLine[] = order.lines.map((l) => ({
        productId: l.productId,
        companyId: l.companyId,
        quantity: l.quantity,
        rate: l.rate.toString(),
        discountType: l.discountType as DiscountType,
        discountValue: l.discountValue.toString(),
      }));
      const kept = deliveredLines(booked, results);
      const bookedByCompany = new Map<string, Prisma.Decimal>();
      for (const l of order.lines)
        bookedByCompany.set(
          l.companyId,
          (bookedByCompany.get(l.companyId) ?? D(0)).add(l.netAmount),
        );
      const newTotals = billTotals(kept);
      if (results.length > 0) {
        const revision = bill.currentRevision + 1;
        await tx.bill.update({
          where: { id: bill.id },
          data: {
            currentRevision: revision,
            grossAmount: D(newTotals.total.grossAmount.toString()),
            discountAmount: D(newTotals.total.discountAmount.toString()),
            taxAmount: D(newTotals.total.taxAmount.toString()),
            netAmount: D(newTotals.total.netAmount.toString()),
          },
        });
        const summary = results
          .map(
            (r) =>
              `${names.get(r.productId)}${r.returned ? ` returned ${formatDozens(r.returned)}` : ""}${r.damaged ? ` damaged ${formatDozens(r.damaged)}` : ""}`,
          )
          .join("; ");
        await writeBillRevision(tx, ctx, bill.id, revision, `Day-end: ${summary}`, kept);
        for (const [companyId, old] of bookedByCompany) {
          const now = D((newTotals.byCompany.get(companyId)?.netAmount ?? 0).toString());
          const less = old.sub(now);
          if (less.lte(0)) continue;
          await tx.ledgerEntry.create({
            data: {
              tenantId: ctx.user.tenantId,
              partyType: "CUSTOMER",
              customerId: order.customerId,
              companyId,
              type: "BILL_REVISION",
              entryDate: date,
              credit: less,
              description: `Bill #${bill.number} revised at day-end (returns / damage)`,
              referenceType: "Bill",
              referenceId: bill.id,
              createdById: ctx.user.id,
            },
          });
        }
      }

      // Payments collected by the driver.
      // An advance (the customer owes nothing) goes to this order's companies.
      const fallbackCompanies: [string, Prisma.Decimal][] =
        newTotals.byCompany.size > 0
          ? [...newTotals.byCompany].map(([c, t]) => [c, D(t.netAmount.toString())])
          : [...bookedByCompany];
      const collected: { method: PaymentMethod; amount: string; number: number }[] = [];
      const pay = async (
        method: PaymentMethod,
        amount: string | null,
        extra: {
          reference?: string | null;
          cheque?: { chequeNo: string; bankName: string; chequeDate: Date };
        },
      ) => {
        if (!amount) return;
        const { payment } = await postCustomerPayment(tx, ctx, {
          customerId: order.customerId,
          paymentDate: date,
          method,
          amount: D(amount),
          collectedVia: "DELIVERY",
          salesOrderId: order.id,
          fallbackCompanies,
          ...extra,
        });
        collected.push({ method, amount, number: payment.number });
      };
      await pay("CASH", data.cash, {});
      await pay("CHEQUE", data.chequeAmount, {
        cheque: data.chequeAmount
          ? { chequeNo: data.chequeNo!, bankName: data.bankName!, chequeDate: data.chequeDate! }
          : undefined,
      });
      await pay("ONLINE", data.onlineAmount, { reference: data.onlineReference });

      // Close the trip once every order on it is entered.
      const open = await tx.salesOrder.count({
        where: { tripId: order.tripId, status: "DISPATCHED" },
      });
      if (open === 0) {
        await tx.deliveryTrip.updateMany({
          where: { id: order.tripId!, status: "DISPATCHED" },
          data: { status: "RECONCILED", reconciledAt: new Date() },
        });
      }

      await writeAudit(tx, ctx.user, {
        action: "POST",
        entityType: "SalesOrder",
        entityId: order.id,
        oldValue: { status: "DISPATCHED", bill: bill.netAmount },
        newValue: {
          status,
          results,
          bill: newTotals.total.netAmount,
          claims,
          payments: collected,
          note: data.note,
        },
        requestId: data.requestId,
      });
      return { orderId: order.id, status, tripId: order.tripId, repeated: false };
    },
    // Serializable: day-end payments must not take the same bill as a payment saved at once.
    { timeout: 60_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/** The next order on the same trip still waiting for its day-end entry (for "save and next"). */
export async function nextOrderToReconcile(ctx: ServiceCtx, tripId: string) {
  assertCan(ctx.user.role, "operations.manage");
  const orders = await ctx.db.salesOrder.findMany({
    where: { tripId, status: "DISPATCHED" },
    select: {
      id: true,
      customer: {
        select: {
          name: true,
          routeSequence: true,
          area: { select: { name: true, sortOrder: true } },
        },
      },
    },
  });
  orders.sort(byRoute);
  return orders[0]?.id ?? null;
}
