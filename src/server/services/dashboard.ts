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

export async function getDashboard(ctx: ServiceCtx) {
  assertCan(ctx.user.role, "operations.manage");
  const today = businessToday();
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const showMoney = can(ctx.user.role, "payments.manage");

  const [tomorrowOrders, tripsOut, dayEndPending, overLimit, lowStock, money] = await Promise.all([
    ctx.db.salesOrder.groupBy({
      by: ["status"],
      where: { deliveryDate: tomorrow, status: { in: ["BOOKED", "PLANNED"] } },
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
  ]);

  const booked = tomorrowOrders.find((g) => g.status === "BOOKED")?._count._all ?? 0;
  const planned = tomorrowOrders.find((g) => g.status === "PLANNED")?._count._all ?? 0;
  return {
    today,
    work: {
      tomorrow,
      ordersTomorrow: booked + planned,
      notOnTripTomorrow: booked,
      tripsOut: tripsOut.map((t) => ({
        id: t.id,
        number: t.number,
        tripDate: t.tripDate,
        bikeName: t.bike.name,
        driverName: t.driver?.name ?? null,
        ordersPending: t._count.orders,
        late: t.tripDate < today,
      })),
      dayEndPending,
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
  const [collected, cheques, bills] = await Promise.all([
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
    companyBills: {
      overdue: { rows: overdue, total: sum(overdue) },
      dueSoon: { rows: dueSoon, total: sum(dueSoon) },
    },
  };
}

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;
