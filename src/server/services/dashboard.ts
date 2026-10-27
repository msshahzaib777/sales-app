import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { businessToday } from "@/lib/dates";

import { assertCan, can } from "../auth/permissions";
import { listStock } from "./inventory";
import type { ServiceCtx } from "./master/common";
import { customerBalances } from "./master/opening-balances";
import { paidByBill } from "./purchasing/bills";
import { billState } from "./purchasing/calc";

// The dashboard: what needs attention today. Everyone with operations access sees today's work,
// customers over their credit limit and low stock. Money (collections, cheques, company bills)
// is only for roles that handle payments. Nothing here shows profit, margin or purchase cost to
// staff (CLAUDE.md rule 8): company bills are only in the money section.

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);
const DAY_MS = 86_400_000;
/** Company bills due within this many days count as "due soon". */
export const DUE_SOON_DAYS = 7;

/**
 * `date` (default today) picks the day for the day-based figures: that day's trips and deliveries,
 * orders for the next day, money collected and spent, company bills due. Trips still out (any
 * date), pending approvals, credit limits and low stock are always as they are now.
 */
export async function getDashboard(ctx: ServiceCtx, opts: { date?: Date } = {}) {
  assertCan(ctx.user.role, "operations.manage");
  const realToday = businessToday();
  const today = opts.date ?? realToday;
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const showMoney = can(ctx.user.role, "payments.manage");

  const approver = can(ctx.user.role, "stock.approveAdjustment");
  const [
    tomorrowOrders,
    tripsOut,
    dayEndPending,
    overLimit,
    lowStock,
    money,
    adjustmentsPending,
    tripsOnDay,
    counterSales,
  ] = await Promise.all([
    ctx.db.salesOrder.groupBy({
      by: ["status"],
      where: { deliveryDate: tomorrow, status: { not: "CANCELLED" } },
      _count: { _all: true },
    }),
    ctx.db.deliveryTrip.findMany({
      where: { status: "DISPATCHED" },
      orderBy: [{ tripDate: "asc" }, { number: "asc" }],
      select: {
        id: true,
        number: true,
        tripDate: true,
        bike: { select: { name: true } },
        driver: { select: { name: true } },
        _count: { select: { orders: { where: { status: "DISPATCHED" } } } },
      },
    }),
    ctx.db.salesOrder.count({ where: { status: "DISPATCHED" } }),
    customersOverLimit(ctx),
    listStock(ctx, { low: true, page: 1 }),
    showMoney ? moneyToday(ctx, today) : Promise.resolve(null),
    approver
      ? ctx.db.stockAdjustment.count({ where: { status: "PENDING" } })
      : Promise.resolve(null),
    // The chosen day's trips, with their orders: how the day's deliveries went.
    ctx.db.deliveryTrip.findMany({
      where: { tripDate: today },
      orderBy: { number: "asc" },
      select: {
        id: true,
        number: true,
        status: true,
        bike: { select: { name: true } },
        driver: { select: { name: true } },
        orders: {
          where: { status: { not: "CANCELLED" } },
          select: {
            status: true,
            lines: { select: { quantity: true, returnedQuantity: true, damagedQuantity: true } },
            bill: { select: { netAmount: true, postedAt: true } },
          },
        },
      },
    }),
    // The chosen day's counter sales (collected at the warehouse, no trip).
    ctx.db.bill.aggregate({
      where: {
        billDate: today,
        status: "POSTED",
        postedAt: { not: null },
        salesOrder: { fulfilment: "COUNTER" },
      },
      _sum: { netAmount: true },
      _count: { _all: true },
    }),
  ]);

  const dayOrders = tripsOnDay.flatMap((t) => t.orders);
  const countOf = (status: string) => dayOrders.filter((o) => o.status === status).length;
  const lines = dayOrders.flatMap((o) => o.lines);
  const day = {
    trips: tripsOnDay.map((t) => ({
      id: t.id,
      number: t.number,
      status: t.status,
      bikeName: t.bike.name,
      driverName: t.driver?.name ?? null,
      orders: t.orders.length,
      toEnter: t.orders.filter((o) => o.status === "DISPATCHED").length,
    })),
    planned: tripsOnDay.filter((t) => t.status === "PLANNED").length,
    out: tripsOnDay.filter((t) => t.status === "DISPATCHED").length,
    done: tripsOnDay.filter((t) => t.status === "RECONCILED").length,
    orders: dayOrders.length,
    delivered: countOf("DELIVERED"),
    partly: countOf("PARTIALLY_DELIVERED"),
    returned: countOf("RETURNED"),
    stillOut: countOf("DISPATCHED"),
    notDispatched: dayOrders.filter((o) => o.status === "BOOKED" || o.status === "PLANNED").length,
    /** Dozens sent out, and kept by customers once day-end is entered (packets). */
    sent: lines.reduce((s, l) => s + l.quantity, 0),
    returnedQty: lines.reduce((s, l) => s + l.returnedQuantity, 0),
    damagedQty: lines.reduce((s, l) => s + l.damagedQuantity, 0),
    /** Bills posted at dispatch, after returns once day-end is entered. */
    billed: dayOrders.reduce((s, o) => (o.bill?.postedAt ? s.add(o.bill.netAmount) : s), D(0)),
    counter: { sales: counterSales._count._all, billed: counterSales._sum.netAmount ?? D(0) },
  };

  const booked = tomorrowOrders.find((g) => g.status === "BOOKED")?._count._all ?? 0;
  const ordersTomorrow = tomorrowOrders.reduce((n, g) => n + g._count._all, 0);
  return {
    today,
    isToday: today.getTime() === realToday.getTime(),
    work: {
      /** The chosen day's trips and deliveries. */
      day,
      tomorrow,
      ordersTomorrow,
      notOnTripTomorrow: booked,
      tripsOut: tripsOut.map((t) => ({
        id: t.id,
        number: t.number,
        tripDate: t.tripDate,
        bikeName: t.bike.name,
        driverName: t.driver?.name ?? null,
        ordersPending: t._count.orders,
        late: t.tripDate < realToday,
      })),
      dayEndPending,
      /** Stock adjustments waiting for approval (null when the user can't approve them). */
      adjustmentsPending,
    },
    overLimit,
    lowStock: { rows: lowStock.rows.slice(0, 10), total: lowStock.total },
    money,
  };
}

/** Active customers whose balance is above their credit limit, most over first. */
async function customersOverLimit(ctx: ServiceCtx) {
  const customers = await ctx.db.customer.findMany({
    where: { isActive: true, creditLimit: { not: null } },
    select: { id: true, name: true, shopName: true, creditLimit: true, isFlagged: true },
  });
  const balances = await customerBalances(
    ctx.db,
    customers.map((c) => c.id),
  );
  return customers
    .map((c) => {
      const balance = balances.get(c.id) ?? D(0);
      return { ...c, creditLimit: c.creditLimit!, balance, over: balance.sub(c.creditLimit!) };
    })
    .filter((c) => c.over.gt(0))
    .sort((a, b) => b.over.comparedTo(a.over));
}

async function moneyToday(ctx: ServiceCtx, today: Date) {
  const [collected, cheques, bills, expenses] = await Promise.all([
    ctx.db.customerPayment.groupBy({
      by: ["method"],
      where: { paymentDate: today, status: "POSTED" },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    ctx.db.customerPayment.aggregate({
      where: { status: "POSTED", cheque: { status: "PENDING" } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    ctx.db.companyBill.findMany({
      where: {
        status: "POSTED",
        dueDate: { lte: new Date(today.getTime() + DUE_SOON_DAYS * DAY_MS) },
      },
      orderBy: [{ dueDate: "asc" }, { number: "asc" }],
      include: { company: { select: { name: true } } },
    }),
    can(ctx.user.role, "expenses.manage")
      ? ctx.db.expense.aggregate({
          where: { expenseDate: today, status: "POSTED" },
          _sum: { amount: true },
          _count: { _all: true },
        })
      : Promise.resolve(null),
  ]);
  const paid = await paidByBill(
    ctx.db,
    bills.map((b) => b.id),
  );
  const open = bills
    .map((b) => ({
      id: b.id,
      number: b.number,
      companyName: b.company.name,
      dueDate: b.dueDate,
      ...billState(b, paid.get(b.id) ?? 0, today),
    }))
    .filter((b) => b.outstanding.gt(0));
  const by = (method: "CASH" | "CHEQUE" | "ONLINE") => {
    const g = collected.find((x) => x.method === method);
    return { amount: g?._sum.amount ?? D(0), count: g?._count._all ?? 0 };
  };
  const sum = (rows: typeof open) => rows.reduce((s, b) => s.add(b.outstanding), D(0));
  const overdue = open.filter((b) => b.overdue);
  const dueSoon = open.filter((b) => !b.overdue);
  return {
    collected: { cash: by("CASH"), cheque: by("CHEQUE"), online: by("ONLINE") },
    collectedTotal: collected.reduce((s, g) => s.add(g._sum.amount ?? 0), D(0)),
    chequesToClear: { amount: cheques._sum.amount ?? D(0), count: cheques._count._all },
    expensesToday: expenses
      ? { amount: expenses._sum.amount ?? D(0), count: expenses._count._all }
      : null,
    companyBills: {
      overdue: { rows: overdue, total: sum(overdue) },
      dueSoon: { rows: dueSoon, total: sum(dueSoon) },
    },
  };
}

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;
