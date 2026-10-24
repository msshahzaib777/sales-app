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
import { businessToday } from "@/lib/dates";
import { calculateLineAmounts, type DiscountType } from "@/lib/pricing";
import { billTotals } from "@/lib/sales";
import { formatDozens, HALF_DOZENS_PER_DOZEN } from "@/lib/units";
import { dayEndSchema } from "@/lib/validation/delivery";
import { reverseSchema } from "@/lib/validation/purchasing";

import { writeAudit } from "../../audit";
import { assertCan } from "../../auth/permissions";
import type { TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";
import type { ServiceCtx } from "../master/common";
import { postCustomerPayment, reversePayment } from "../payments/customer-payments";
import { found, reverseLedgerFor } from "../posting";
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

/**
 * Undoes a saved day-end entry so it can be entered again (CLAUDE.md rule 2: by reversal, nothing
 * is edited or deleted). In one transaction:
 *  - the return and damage stock movements get mirror movements (stock is back as dispatched);
 *  - its damage claims are cancelled (refused if one was already deducted on a company bill);
 *  - the bill is restored to what was dispatched, as a new revision, and its day-end reductions
 *    are reversed in the customer ledger;
 *  - the payments collected at that delivery are reversed (refused if a cheque has cleared);
 *  - the order is Dispatched again and its trip is open again.
 */
export async function undoDayEnd(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "payments.manage");
  const { id, reason } = reverseSchema.parse(input);
  return ctx.db.$transaction(
    async (tx) => {
      const order = found(
        await tx.salesOrder.findUnique({
          where: { id },
          include: {
            lines: { include: { product: { select: { name: true } } } },
            bill: true,
            claims: { include: { appliedToBill: { select: { number: true } } } },
            payments: {
              where: { status: "POSTED", collectedVia: "DELIVERY" },
              include: { cheque: true },
            },
          },
        }),
        "order",
      );
      if (!order.reconciledAt || !order.tripId)
        throw new ServiceError(`Day-end for order #${order.number} has not been entered.`);
      const today = businessToday();
      const note = `Day-end of order #${order.number} undone: ${reason}`;

      // Refuse first, before anything is posted.
      const applied = order.claims.find((c) => c.status === "APPLIED");
      if (applied)
        throw new ServiceError(
          `Damage claim #${applied.number} was already deducted on company bill #${applied.appliedToBill?.number}. Cancel that goods receipt first, or correct this order with a new claim instead.`,
        );
      const cleared = order.payments.find((p) => p.cheque?.status === "CLEARED");
      if (cleared)
        throw new ServiceError(
          `Payment #${cleared.number} is a cheque that has already cleared, so it cannot be undone.`,
        );

      // Stock: mirror the day-end movements (returns and damage), never the dispatch.
      const moves = await tx.stockMovement.findMany({
        where: {
          referenceType: "SalesOrder",
          referenceId: order.id,
          type: { in: ["CUSTOMER_RETURN", "DELIVERY_DAMAGE"] },
          reversedBy: { none: {} },
        },
      });
      for (const m of moves) {
        const balance = await tx.stockMovement.aggregate({
          where: { productId: m.productId, warehouseId: m.warehouseId, bucket: m.bucket },
          _sum: { quantity: true },
        });
        if ((balance._sum.quantity ?? 0) < m.quantity) {
          const name =
            order.lines.find((l) => l.productId === m.productId)?.product.name ?? "A product";
          throw new ServiceError(
            `${name}: the ${m.bucket === "DAMAGED" ? "damaged" : "returned"} stock from this order has already been ${m.bucket === "DAMAGED" ? "sent back" : "used"}, so the day-end cannot be undone.`,
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
            occurredAt: today,
            referenceType: "SalesOrder",
            referenceId: order.id,
            reversalOfId: m.id,
            note,
            createdById: ctx.user.id,
          },
        });
      }

      // Claims for damage on this delivery.
      for (const c of order.claims.filter((x) => x.status === "PENDING")) {
        await reverseLedgerFor(
          tx,
          ctx,
          { type: "CompanyClaim", id: c.id },
          today,
          `Cancelled claim #${c.number}: ${note}`,
        );
        await tx.companyClaim.update({
          where: { id: c.id },
          data: { status: "REVERSED", reversedAt: new Date() },
        });
      }

      // Bill back to what was dispatched.
      const bill = order.bill!;
      const dispatched = order.lines.map((l) => ({
        productId: l.productId,
        companyId: l.companyId,
        quantity: l.quantity,
        rate: l.rate,
        discountType: l.discountType as DiscountType,
        discountValue: l.discountValue,
        grossAmount: l.grossAmount,
        discountAmount: l.discountAmount,
        taxAmount: l.taxAmount,
        netAmount: l.netAmount,
      }));
      const totals = billTotals(dispatched).total;
      if (!D(totals.netAmount.toString()).eq(bill.netAmount)) {
        const revision = bill.currentRevision + 1;
        await tx.bill.update({
          where: { id: bill.id },
          data: {
            currentRevision: revision,
            grossAmount: D(totals.grossAmount.toString()),
            discountAmount: D(totals.discountAmount.toString()),
            taxAmount: D(totals.taxAmount.toString()),
            netAmount: D(totals.netAmount.toString()),
          },
        });
        await writeBillRevision(
          tx,
          ctx,
          bill.id,
          revision,
          `Day-end undone: ${reason}`,
          dispatched,
        );
        await reverseLedgerFor(
          tx,
          ctx,
          { type: "Bill", id: bill.id },
          today,
          `Bill #${bill.number}: ${note}`,
          "REVERSAL",
          ["BILL_REVISION"],
        );
      }
      await tx.salesOrderLine.updateMany({
        where: { salesOrderId: order.id },
        data: { returnedQuantity: 0, damagedQuantity: 0 },
      });

      // Payments collected at this delivery.
      for (const p of order.payments) await reversePayment(tx, ctx, p.id, note, "REVERSAL");

      await tx.salesOrder.update({
        where: { id: order.id },
        data: {
          status: "DISPATCHED",
          reconciledAt: null,
          reconciledById: null,
          reconcileRequestId: null,
        },
      });
      await tx.deliveryTrip.updateMany({
        where: { id: order.tripId, status: "RECONCILED" },
        data: { status: "DISPATCHED", reconciledAt: null },
      });
      await writeAudit(tx, ctx.user, {
        action: "REVERSE",
        entityType: "SalesOrder",
        entityId: order.id,
        oldValue: {
          status: order.status,
          lines: order.lines
            .filter((l) => l.returnedQuantity || l.damagedQuantity)
            .map((l) => ({
              productId: l.productId,
              returned: l.returnedQuantity,
              damaged: l.damagedQuantity,
            })),
          bill: bill.netAmount,
          claims: order.claims.filter((c) => c.status === "PENDING").map((c) => c.number),
          payments: order.payments.map((p) => ({ number: p.number, amount: p.amount })),
        },
        newValue: { status: "DISPATCHED", bill: totals.netAmount, reason },
      });
      return { orderId: order.id, tripId: order.tripId };
    },
    { timeout: 60_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
