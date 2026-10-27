import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { assertCan, can } from "../auth/permissions";
import type { ServiceCtx } from "./master/common";

// Trends for the dashboard, ending on the dashboard's day: how sales, collections and what is owed
// are moving. Everyone with operations access sees sales; billed-vs-collected needs payments
// access and balances need ledger access. No profit or cost here (CLAUDE.md rule 8).

const DAY_MS = 86_400_000;
const D = (v: Prisma.Decimal | number | string | null | undefined) => new Prisma.Decimal(v ?? 0);
const num = (v: Prisma.Decimal) => Number(v.toFixed(2));
const key = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);

export const SALES_DAYS = 30;
export const WEEKS = 12;

/** The 12 weeks ending on `date`, oldest first: [from, to] inclusive. */
function weeksEnding(date: Date) {
  return Array.from({ length: WEEKS }, (_, i) => {
    const to = addDays(date, -7 * (WEEKS - 1 - i));
    return { from: addDays(to, -6), to };
  });
}

export async function getDashboardCharts(ctx: ServiceCtx, date: Date) {
  assertCan(ctx.user.role, "operations.manage");
  const salesFrom = addDays(date, -(SALES_DAYS - 1));
  const weeks = weeksEnding(date);
  const weeksFrom = weeks[0]!.from;
  const posted = { status: "POSTED" as const, postedAt: { not: null } };
  const showMoney = can(ctx.user.role, "payments.manage");
  const showLedgers = can(ctx.user.role, "ledgers.view");

  const [allBills, counterBills, byCompany, companies, collected, balances] = await Promise.all([
    ctx.db.bill.groupBy({
      by: ["billDate"],
      where: { ...posted, billDate: { gte: showMoney ? weeksFrom : salesFrom, lte: date } },
      _sum: { netAmount: true },
    }),
    ctx.db.bill.groupBy({
      by: ["billDate"],
      where: {
        ...posted,
        billDate: { gte: salesFrom, lte: date },
        salesOrder: { fulfilment: "COUNTER" },
      },
      _sum: { netAmount: true },
    }),
    // Sales per company from the customer ledger: bills less day-end corrections.
    ctx.db.ledgerEntry.groupBy({
      by: ["companyId"],
      where: {
        partyType: "CUSTOMER",
        type: { in: ["SALES_BILL", "BILL_REVISION"] },
        companyId: { not: null },
        entryDate: { gte: salesFrom, lte: date },
      },
      _sum: { debit: true, credit: true },
    }),
    ctx.db.company.findMany({ select: { id: true, name: true } }),
    showMoney
      ? ctx.db.customerPayment.groupBy({
          by: ["paymentDate"],
          where: { status: "POSTED", paymentDate: { gte: weeksFrom, lte: date } },
          _sum: { amount: true },
        })
      : Promise.resolve(null),
    showLedgers
      ? ctx.db.ledgerEntry.groupBy({
          by: ["partyType", "entryDate"],
          where: { partyType: { in: ["CUSTOMER", "COMPANY"] }, entryDate: { lte: date } },
          _sum: { debit: true, credit: true },
        })
      : Promise.resolve(null),
  ]);

  const billed = new Map(allBills.map((b) => [key(b.billDate), D(b._sum.netAmount)]));
  const counter = new Map(counterBills.map((b) => [key(b.billDate), D(b._sum.netAmount)]));
  const sales = Array.from({ length: SALES_DAYS }, (_, i) => {
    const day = addDays(salesFrom, i);
    const total = billed.get(key(day)) ?? D(0);
    const atCounter = counter.get(key(day)) ?? D(0);
    return { date: key(day), delivery: num(total.sub(atCounter)), counter: num(atCounter) };
  });

  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const salesByCompany = byCompany
    .map((g) => ({
      name: companyName.get(g.companyId!) ?? "",
      amount: num(D(g._sum.debit).sub(D(g._sum.credit))),
    }))
    .filter((c) => c.amount !== 0)
    .sort((a, b) => b.amount - a.amount);

  const inWeek = (rows: { at: Date; amount: Prisma.Decimal }[], w: { from: Date; to: Date }) =>
    rows.filter((r) => r.at >= w.from && r.at <= w.to).reduce((s, r) => s.add(r.amount), D(0));

  const billedVsCollected = collected
    ? weeks.map((w) => ({
        weekEnding: key(w.to),
        billed: num(
          inWeek(
            allBills.map((b) => ({ at: b.billDate, amount: D(b._sum.netAmount) })),
            w,
          ),
        ),
        collected: num(
          inWeek(
            collected.map((c) => ({ at: c.paymentDate, amount: D(c._sum.amount) })),
            w,
          ),
        ),
      }))
    : null;

  // Balance at each week's end = every entry up to then (customers: debit − credit; companies,
  // what we owe: credit − debit).
  const owed = balances
    ? weeks.map((w) => {
        let customers = D(0);
        let companiesOwed = D(0);
        for (const b of balances) {
          if (b.entryDate > w.to) continue;
          const net = D(b._sum.debit).sub(D(b._sum.credit));
          if (b.partyType === "CUSTOMER") customers = customers.add(net);
          else companiesOwed = companiesOwed.sub(net);
        }
        return { weekEnding: key(w.to), customers: num(customers), companies: num(companiesOwed) };
      })
    : null;

  return { sales, salesByCompany, billedVsCollected, owed };
}

export type DashboardCharts = Awaited<ReturnType<typeof getDashboardCharts>>;
