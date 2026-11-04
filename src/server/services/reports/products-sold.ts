import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { periodOf } from "@/lib/analysis";
import { businessToday } from "@/lib/dates";
import { filterParam } from "@/lib/list-params";

import { assertCan, can } from "../../auth/permissions";
import type { ServiceCtx } from "../master/common";
import { parseDateRange } from "../purchasing/filters";

// Products sold over a day, a week, a month or any dates: how much of each product went to
// customers. Same meaning of "sold" as the daily report: posted bills in the dates, at their latest
// revision, so returns and damage are already taken off. Deliveries and counter sales both count.
// Bookers see quantities only; the sales value needs reports.view (never cost or profit).

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);
const ZERO = D(0);
const DAY_MS = 86_400_000;

export const SOLD_PERIODS = ["day", "week", "month", "custom"] as const;
export type SoldPeriod = (typeof SOLD_PERIODS)[number];

type SnapshotLine = { productId: string; quantity: number; netAmount: string };

/** The dates of a period that contains `date` (custom: the given from/to, default one day). */
export function soldRange(
  period: SoldPeriod,
  date: Date,
  custom: { from?: Date; to?: Date } = {},
): { from: Date; to: Date } {
  if (period === "week" || period === "month") return periodOf(period, date);
  if (period === "custom") {
    const from = custom.from ?? custom.to ?? date;
    return { from, to: custom.to ?? from };
  }
  return { from: date, to: date };
}

/** ?period=day|week|month|custom&date=…&from=…&to=…&companyId=… (default: today). */
export function soldParams(sp: Record<string, unknown>) {
  const p = filterParam(sp, "period");
  const period: SoldPeriod = (SOLD_PERIODS as readonly string[]).includes(p ?? "")
    ? (p as SoldPeriod)
    : "day";
  const date = parseDateRange({ from: sp.date }).from ?? businessToday();
  const custom = parseDateRange({ from: sp.from, to: sp.to });
  return {
    period,
    date,
    companyId: filterParam(sp, "companyId"),
    ...soldRange(period, date, custom),
  };
}

export async function productsSold(
  ctx: ServiceCtx,
  f: { from: Date; to: Date; companyId?: string },
) {
  assertCan(ctx.user.role, "reports.productsSold");
  const showAmounts = can(ctx.user.role, "reports.view");
  const [bills, products, companies] = await Promise.all([
    ctx.db.bill.findMany({
      where: { billDate: { gte: f.from, lte: f.to }, postedAt: { not: null }, status: "POSTED" },
      select: {
        customerId: true,
        billDate: true,
        salesOrder: { select: { fulfilment: true } },
        revisions: { orderBy: { revision: "desc" }, take: 1, select: { lines: true } },
      },
    }),
    ctx.db.product.findMany({
      select: { id: true, code: true, name: true, companyId: true },
    }),
    ctx.db.company.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  type Row = {
    quantity: number;
    counter: number;
    amount: Prisma.Decimal;
    bills: number;
    customers: Set<string>;
    days: Set<string>;
  };
  const sold = new Map<string, Row>();
  for (const b of bills) {
    const counter = b.salesOrder.fulfilment === "COUNTER";
    for (const l of (b.revisions[0]?.lines ?? []) as SnapshotLine[]) {
      const p = productById.get(l.productId);
      if (!p || (f.companyId && p.companyId !== f.companyId) || l.quantity <= 0) continue;
      const r = sold.get(l.productId) ?? {
        quantity: 0,
        counter: 0,
        amount: ZERO,
        bills: 0,
        customers: new Set<string>(),
        days: new Set<string>(),
      };
      r.quantity += l.quantity;
      if (counter) r.counter += l.quantity;
      r.amount = r.amount.add(l.netAmount);
      r.bills += 1;
      r.customers.add(b.customerId);
      r.days.add(b.billDate.toISOString().slice(0, 10));
      sold.set(l.productId, r);
    }
  }

  const rows = [...sold]
    .map(([productId, r]) => {
      const p = productById.get(productId)!;
      return {
        productId,
        code: p.code,
        name: p.name,
        companyName: companyName.get(p.companyId) ?? "",
        quantity: r.quantity,
        /** Of the quantity, sold at the counter (collected at the warehouse). */
        counter: r.counter,
        bills: r.bills,
        customers: r.customers.size,
        /** Days in the dates on which it sold. */
        days: r.days.size,
        amount: showAmounts ? r.amount : null,
      };
    })
    // Most sold first.
    .sort((a, b) => b.quantity - a.quantity || a.code.localeCompare(b.code));

  const dayCount = Math.round((f.to.getTime() - f.from.getTime()) / DAY_MS) + 1;
  return {
    from: f.from,
    to: f.to,
    dayCount,
    showAmounts,
    companies,
    rows,
    totals: {
      quantity: rows.reduce((s, r) => s + r.quantity, 0),
      counter: rows.reduce((s, r) => s + r.counter, 0),
      amount: showAmounts ? rows.reduce((s, r) => s.add(r.amount!), ZERO) : null,
      products: rows.length,
    },
  };
}

export type ProductsSold = Awaited<ReturnType<typeof productsSold>>;
