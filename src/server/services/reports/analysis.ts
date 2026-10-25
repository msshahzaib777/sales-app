import "server-only";

import { Prisma } from "@/generated/prisma/client";
import {
  changePct,
  daysBetween,
  LATE_DAYS,
  type PeriodKind,
  periodLabel,
  type PeriodRange,
  shiftPeriod,
  TREND_LENGTH,
  type Trend,
  trendOf,
} from "@/lib/analysis";
import { businessToday } from "@/lib/dates";
import { calculateLineAmounts } from "@/lib/pricing";
import { PACKETS_PER_DOZEN } from "@/lib/units";

import { assertCan, can } from "../../auth/permissions";
import type { ServiceCtx } from "../master/common";
import { companyPayables, customerBalances } from "../master/opening-balances";

// Business analysis (Reports → Business analysis): one week, month or quarter against the one
// before it, and the trend over the last periods.
// - Sales are posted bills by bill date (the trip date), at their latest revision, so returns and
//   damage entered at day-end are already off. Cost is at each product's current purchase rate
//   (batches keep no cost of their own yet).
// - Products: demand by dozens sold; rising / declining / new / stopped against the previous period.
// - Companies: sales, cost, gross profit and margin per company (cost roles only).
// - Customers: purchases against the previous period, days taken to pay (from the bills each
//   payment settled), oldest unpaid bill, bounced cheques, balance now (payment roles only).
// Staff see quantities and sales only, never cost or profit (CLAUDE.md rule 8).

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);
const ZERO = D(0);

type SnapshotLine = { productId: string; companyId: string; quantity: number; netAmount: string };

const inRange = (d: Date, r: PeriodRange) => d >= r.from && d <= r.to;
const dateWhere = (r: { from: Date; to: Date }) => ({ gte: r.from, lte: r.to });

/** A figure this period and the period before, with the change in %. */
function compare(current: Prisma.Decimal | number, previous: Prisma.Decimal | number) {
  const c = D(current);
  const p = D(previous);
  return { current: c, previous: p, change: changePct(c.toNumber(), p.toNumber()) };
}

export async function businessAnalysis(ctx: ServiceCtx, kind: PeriodKind, date: Date) {
  assertCan(ctx.user.role, "operations.manage");
  const showCost = can(ctx.user.role, "financials.view");
  const showMoney = can(ctx.user.role, "payments.manage");

  const current = shiftPeriod(kind, date, 0);
  const previous = shiftPeriod(kind, date, -1);
  const buckets = Array.from({ length: TREND_LENGTH[kind] }, (_, i) =>
    shiftPeriod(kind, date, i - TREND_LENGTH[kind] + 1),
  );
  const span = { from: buckets[0]!.from, to: current.to };
  const both = { from: previous.from, to: current.to };

  const [bills, products, companies, expenses, orderLines] = await Promise.all([
    ctx.db.bill.findMany({
      where: { status: "POSTED", postedAt: { not: null }, billDate: dateWhere(span) },
      select: {
        id: true,
        billDate: true,
        customerId: true,
        netAmount: true,
        revisions: { orderBy: { revision: "desc" }, take: 1, select: { lines: true } },
      },
    }),
    ctx.db.product.findMany({
      select: { id: true, code: true, name: true, companyId: true, purchaseRate: true },
    }),
    ctx.db.company.findMany({ select: { id: true, name: true } }),
    showCost
      ? ctx.db.expense.findMany({
          where: { status: "POSTED", expenseDate: dateWhere(span) },
          select: { expenseDate: true, amount: true },
        })
      : Promise.resolve([]),
    // Sent, returned and damaged, for return rates.
    ctx.db.salesOrderLine.findMany({
      where: {
        salesOrder: {
          bill: { status: "POSTED", postedAt: { not: null }, billDate: dateWhere(both) },
        },
      },
      select: {
        productId: true,
        quantity: true,
        returnedQuantity: true,
        damagedQuantity: true,
        salesOrder: { select: { bill: { select: { billDate: true } } } },
      },
    }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  const costOf = (productId: string, quantity: number) => {
    const p = productById.get(productId);
    if (!p) return ZERO;
    const amount = calculateLineAmounts({
      quantity,
      baseUnitsPerPriceUnit: PACKETS_PER_DOZEN,
      rate: p.purchaseRate,
    }).netAmount;
    return D(amount.toString());
  };
  const linesOf = (b: (typeof bills)[number]) => (b.revisions[0]?.lines ?? []) as SnapshotLine[];

  // ── Trend: sales, gross profit, net profit per period ──
  const trend = buckets.map((r) => {
    const inBucket = bills.filter((b) => inRange(b.billDate, r));
    const sales = inBucket.reduce((s, b) => s.add(b.netAmount), ZERO);
    const cost = showCost
      ? inBucket.flatMap(linesOf).reduce((s, l) => s.add(costOf(l.productId, l.quantity)), ZERO)
      : null;
    const spent = expenses
      .filter((e) => inRange(e.expenseDate, r))
      .reduce((s, e) => s.add(e.amount), ZERO);
    return {
      label: periodLabel(kind, r),
      from: r.from,
      sales,
      orders: inBucket.length,
      gross: cost ? sales.sub(cost) : null,
      net: cost ? sales.sub(cost).sub(spent) : null,
    };
  });
  const cur = trend.at(-1)!;
  const prev = trend.at(-2)!;

  // ── Products ──
  type Agg = { qty: number; amount: Prisma.Decimal; cost: Prisma.Decimal };
  const emptyAgg = (): Agg => ({ qty: 0, amount: ZERO, cost: ZERO });
  const byProduct = new Map<string, { cur: Agg; prev: Agg }>();
  const byCompany = new Map<string, { cur: Agg; prev: Agg }>();
  for (const b of bills) {
    const which = inRange(b.billDate, current)
      ? "cur"
      : inRange(b.billDate, previous)
        ? "prev"
        : null;
    if (!which) continue;
    for (const l of linesOf(b)) {
      const cost = showCost ? costOf(l.productId, l.quantity) : ZERO;
      for (const [map, key] of [
        [byProduct, l.productId],
        [byCompany, l.companyId],
      ] as const) {
        const row = map.get(key) ?? { cur: emptyAgg(), prev: emptyAgg() };
        const a = row[which];
        a.qty += l.quantity;
        a.amount = a.amount.add(l.netAmount);
        a.cost = a.cost.add(cost);
        map.set(key, row);
      }
    }
  }
  const sentBack = new Map<string, { sent: number; back: number }>();
  for (const l of orderLines) {
    const billDate = l.salesOrder.bill?.billDate;
    if (!billDate || !inRange(billDate, current)) continue;
    const s = sentBack.get(l.productId) ?? { sent: 0, back: 0 };
    s.sent += l.quantity;
    s.back += l.returnedQuantity + l.damagedQuantity;
    sentBack.set(l.productId, s);
  }
  const productRows = [...byProduct]
    .map(([productId, a]) => {
      const p = productById.get(productId);
      const sb = sentBack.get(productId);
      return {
        productId,
        code: p?.code ?? "",
        name: p?.name ?? "",
        companyName: p ? (companyName.get(p.companyId) ?? "") : "",
        qty: compare(a.cur.qty, a.prev.qty),
        amount: compare(a.cur.amount, a.prev.amount),
        profit: showCost ? a.cur.amount.sub(a.cur.cost) : null,
        /** Returned and damaged as % of what was sent out this period. */
        returnRate: sb && sb.sent ? (sb.back / sb.sent) * 100 : null,
        trend: trendOf(a.cur.qty, a.prev.qty) as Trend,
      };
    })
    .sort((x, y) => y.amount.current.comparedTo(x.amount.current) || x.code.localeCompare(y.code));
  const changeOf = (r: (typeof productRows)[number]) =>
    r.qty.current.sub(r.qty.previous).toNumber();

  // ── Companies (cost roles) ──
  const companyRows = showCost ? await companyAnalysis(ctx, byCompany, companyName, current) : null;

  // ── Customers (payment roles) ──
  const customers = showMoney ? await customerAnalysis(ctx, bills, current, previous) : null;

  return {
    kind,
    current: { ...current, label: periodLabel(kind, current) },
    previous: { ...previous, label: periodLabel(kind, previous) },
    showCost,
    showMoney,
    overview: {
      sales: compare(cur.sales, prev.sales),
      orders: compare(cur.orders, prev.orders),
      gross: showCost ? compare(cur.gross!, prev.gross!) : null,
      margin: showCost && cur.sales.gt(0) ? cur.gross!.div(cur.sales).mul(100).toNumber() : null,
      net: showCost ? compare(cur.net!, prev.net!) : null,
      activeCustomers: compare(
        new Set(bills.filter((b) => inRange(b.billDate, current)).map((b) => b.customerId)).size,
        new Set(bills.filter((b) => inRange(b.billDate, previous)).map((b) => b.customerId)).size,
      ),
      received: customers ? compare(customers.receivedTotal, customers.receivedBefore) : null,
    },
    trend,
    products: {
      rows: productRows,
      rising: productRows
        .filter((r) => r.trend === "RISING" || r.trend === "NEW")
        .sort((a, b) => changeOf(b) - changeOf(a))
        .slice(0, 8),
      declining: productRows
        .filter((r) => r.trend === "DECLINING" || r.trend === "STOPPED")
        .sort((a, b) => changeOf(a) - changeOf(b))
        .slice(0, 8),
    },
    companies: companyRows,
    customers,
  };
}

async function companyAnalysis(
  ctx: ServiceCtx,
  byCompany: Map<
    string,
    {
      cur: { qty: number; amount: Prisma.Decimal; cost: Prisma.Decimal };
      prev: { qty: number; amount: Prisma.Decimal; cost: Prisma.Decimal };
    }
  >,
  companyName: Map<string, string>,
  current: PeriodRange,
) {
  const claims = await ctx.db.companyClaim.groupBy({
    by: ["companyId"],
    where: { claimDate: dateWhere(current), status: { notIn: ["REVERSED", "REJECTED"] } },
    _sum: { claimedAmount: true, amount: true },
  });
  const ids = [...new Set([...byCompany.keys(), ...claims.map((c) => c.companyId)])];
  const payable = await companyPayables(ctx.db, ids);
  return ids
    .map((id) => {
      const a = byCompany.get(id);
      const sales = a?.cur.amount ?? ZERO;
      const gross = sales.sub(a?.cur.cost ?? ZERO);
      const prevGross = (a?.prev.amount ?? ZERO).sub(a?.prev.cost ?? ZERO);
      const claim = claims.find((c) => c.companyId === id);
      return {
        companyId: id,
        name: companyName.get(id) ?? "",
        qty: a?.cur.qty ?? 0,
        sales: compare(sales, a?.prev.amount ?? ZERO),
        cost: a?.cur.cost ?? ZERO,
        gross: compare(gross, prevGross),
        margin: sales.gt(0) ? gross.div(sales).mul(100).toNumber() : null,
        damageClaimed: claim?._sum.claimedAmount ?? claim?._sum.amount ?? ZERO,
        payableNow: payable.get(id) ?? ZERO,
      };
    })
    .sort((x, y) => y.gross.current.comparedTo(x.gross.current));
}

async function customerAnalysis(
  ctx: ServiceCtx,
  bills: { id: string; billDate: Date; customerId: string; netAmount: Prisma.Decimal }[],
  current: PeriodRange,
  previous: PeriodRange,
) {
  const today = businessToday();
  const [payments, allocations, bounces, unpaid] = await Promise.all([
    ctx.db.customerPayment.groupBy({
      by: ["customerId"],
      where: { status: "POSTED", paymentDate: dateWhere({ from: previous.from, to: current.to }) },
      _sum: { amount: true },
    }),
    // Which bills this period's payments settled, and how long after the bill.
    ctx.db.paymentAllocation.findMany({
      where: { customerPayment: { status: "POSTED", paymentDate: dateWhere(current) } },
      select: {
        amount: true,
        bill: { select: { billDate: true, customerId: true } },
        customerPayment: { select: { paymentDate: true } },
      },
    }),
    ctx.db.ledgerEntry.groupBy({
      by: ["customerId"],
      where: { partyType: "CUSTOMER", type: "CHEQUE_BOUNCE", entryDate: dateWhere(current) },
      _count: { _all: true },
    }),
    // Bills not fully paid now: the oldest one says how late a customer is.
    unpaidBills(ctx),
  ]);
  const paidInPeriod = await ctx.db.customerPayment.groupBy({
    by: ["customerId"],
    where: { status: "POSTED", paymentDate: dateWhere(current) },
    _sum: { amount: true },
  });

  const bought = (r: PeriodRange) => {
    const m = new Map<string, Prisma.Decimal>();
    for (const b of bills)
      if (inRange(b.billDate, r))
        m.set(b.customerId, (m.get(b.customerId) ?? ZERO).add(b.netAmount));
    return m;
  };
  const cur = bought(current);
  const prev = bought(previous);

  const days = new Map<string, { weighted: Prisma.Decimal; amount: Prisma.Decimal }>();
  for (const a of allocations) {
    const d = days.get(a.bill.customerId) ?? { weighted: ZERO, amount: ZERO };
    const gap = Math.max(daysBetween(a.bill.billDate, a.customerPayment.paymentDate), 0);
    days.set(a.bill.customerId, {
      weighted: d.weighted.add(a.amount.mul(gap)),
      amount: d.amount.add(a.amount),
    });
  }
  const oldestUnpaid = new Map<string, Date>();
  for (const b of unpaid) {
    const seen = oldestUnpaid.get(b.customerId);
    if (!seen || b.billDate < seen) oldestUnpaid.set(b.customerId, b.billDate);
  }

  const ids = [
    ...new Set([
      ...cur.keys(),
      ...prev.keys(),
      ...[...oldestUnpaid].filter(([, d]) => daysBetween(d, today) > LATE_DAYS).map(([id]) => id),
      ...bounces.map((b) => b.customerId!),
    ]),
  ];
  const [people, balances] = await Promise.all([
    ctx.db.customer.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, shopName: true, phone: true, isFlagged: true },
    }),
    customerBalances(ctx.db, ids),
  ]);
  const received = new Map(paidInPeriod.map((p) => [p.customerId, p._sum.amount ?? ZERO]));

  const rows = people
    .map((c) => {
      const d = days.get(c.id);
      const avgDaysToPay = d && d.amount.gt(0) ? d.weighted.div(d.amount).toNumber() : null;
      const oldest = oldestUnpaid.get(c.id);
      // A bill dated after today (a trip entered early) is not late yet.
      const oldestUnpaidDays = oldest ? Math.max(daysBetween(oldest, today), 0) : null;
      const bounced = bounces.find((b) => b.customerId === c.id)?._count._all ?? 0;
      const curAmount = cur.get(c.id) ?? ZERO;
      const prevAmount = prev.get(c.id) ?? ZERO;
      const late =
        (avgDaysToPay !== null && avgDaysToPay > LATE_DAYS) ||
        (oldestUnpaidDays !== null && oldestUnpaidDays > LATE_DAYS) ||
        bounced > 0;
      return {
        customerId: c.id,
        name: c.name,
        shopName: c.shopName,
        phone: c.phone,
        flagged: c.isFlagged,
        bought: compare(curAmount, prevAmount),
        trend: trendOf(curAmount.toNumber(), prevAmount.toNumber()),
        paid: received.get(c.id) ?? ZERO,
        avgDaysToPay,
        oldestUnpaidDays,
        bounced,
        balance: balances.get(c.id) ?? ZERO,
        late,
      };
    })
    .sort((x, y) => y.bought.current.comparedTo(x.bought.current) || x.name.localeCompare(y.name));

  const growthOf = (r: (typeof rows)[number]) => r.bought.current.sub(r.bought.previous).toNumber();
  return {
    rows,
    late: rows
      .filter((r) => r.late)
      .sort((a, b) => (b.oldestUnpaidDays ?? 0) - (a.oldestUnpaidDays ?? 0))
      .slice(0, 10),
    stopped: rows
      .filter((r) => r.trend === "STOPPED")
      .sort((a, b) => b.bought.previous.comparedTo(a.bought.previous))
      .slice(0, 10),
    growing: rows
      .filter((r) => r.trend === "RISING" || r.trend === "NEW")
      .sort((a, b) => growthOf(b) - growthOf(a))
      .slice(0, 10),
    receivedTotal: [...received.values()].reduce((s, v) => s.add(v), ZERO),
    // `payments` covers the previous and this period; take this period off.
    receivedBefore: payments
      .reduce((s, p) => s.add(p._sum.amount ?? ZERO), ZERO)
      .sub([...received.values()].reduce((s, v) => s.add(v), ZERO)),
  };
}

/** Posted bills with something still unpaid (net amount − allocations of standing payments). */
async function unpaidBills(ctx: ServiceCtx) {
  const bills = await ctx.db.bill.findMany({
    where: { status: "POSTED", postedAt: { not: null } },
    select: { id: true, customerId: true, billDate: true, netAmount: true },
  });
  const paid = await ctx.db.paymentAllocation.groupBy({
    by: ["billId"],
    where: { customerPayment: { status: "POSTED" } },
    _sum: { amount: true },
  });
  const paidOf = new Map(paid.map((p) => [p.billId, p._sum.amount ?? ZERO]));
  return bills.filter((b) => b.netAmount.sub(paidOf.get(b.id) ?? ZERO).gt(0));
}

export type BusinessAnalysis = Awaited<ReturnType<typeof businessAnalysis>>;
