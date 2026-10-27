import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { calculateLineAmounts } from "@/lib/pricing";
import { formatDozens, PACKETS_PER_DOZEN } from "@/lib/units";

import { assertCan, can } from "../../auth/permissions";
import type { ServiceCtx } from "../master/common";

// Daily summary (SPEC §10 "Daily summary"): the numbers to check at day-end, for one business
// date. Everyone with operations access sees deliveries, products sold and stock. Money
// (collections, pending, expenses, company payments, cash in hand) needs payments.manage. Cost,
// gross profit and net profit need financials.view; staff never see them (CLAUDE.md rule 8).
//
// "Sold" means billed to customers on that date: posted bills (billDate = the trip date), at their
// latest revision, so returns and damage entered at day-end are already taken off.

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);
const ZERO = D(0);
const DAY_MS = 86_400_000;

type SnapshotLine = {
  productId: string;
  companyId: string;
  quantity: number;
  netAmount: string;
};

const sum = <T>(rows: T[], f: (r: T) => Prisma.Decimal | null | undefined) =>
  rows.reduce((s, r) => s.add(f(r) ?? ZERO), ZERO);

export async function dailyReport(ctx: ServiceCtx, date: Date) {
  assertCan(ctx.user.role, "operations.manage");
  const showMoney = can(ctx.user.role, "payments.manage");
  const showCost = can(ctx.user.role, "financials.view");
  const next = new Date(date.getTime() + DAY_MS);

  // ── Deliveries and products sold ──
  const [orders, products, companies] = await Promise.all([
    ctx.db.salesOrder.findMany({
      where: { bill: { billDate: date, postedAt: { not: null }, status: "POSTED" } },
      select: {
        id: true,
        number: true,
        status: true,
        fulfilment: true,
        customer: { select: { name: true } },
        lines: {
          select: {
            productId: true,
            quantity: true,
            returnedQuantity: true,
            damagedQuantity: true,
          },
        },
        bill: {
          select: {
            netAmount: true,
            revisions: { orderBy: { revision: "desc" }, take: 1, select: { lines: true } },
          },
        },
      },
    }),
    ctx.db.product.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        companyId: true,
        purchaseRate: true,
        minStockLevel: true,
      },
    }),
    ctx.db.company.findMany({ select: { id: true, name: true } }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  const sold = new Map<string, { quantity: number; amount: Prisma.Decimal }>();
  for (const o of orders) {
    for (const l of (o.bill?.revisions[0]?.lines ?? []) as SnapshotLine[]) {
      const s = sold.get(l.productId) ?? { quantity: 0, amount: ZERO };
      sold.set(l.productId, {
        quantity: s.quantity + l.quantity,
        amount: s.amount.add(l.netAmount),
      });
    }
  }
  const productsSold = [...sold]
    .map(([productId, s]) => {
      const p = productById.get(productId)!;
      // Cost at today's purchase rate (batches keep no cost of their own yet).
      const cost = showCost
        ? calculateLineAmounts({
            quantity: s.quantity,
            baseUnitsPerPriceUnit: PACKETS_PER_DOZEN,
            rate: p.purchaseRate,
          }).netAmount
        : null;
      return {
        productId,
        code: p.code,
        name: p.name,
        companyName: companyName.get(p.companyId) ?? "",
        quantity: s.quantity,
        amount: s.amount,
        cost: cost ? D(cost.toString()) : null,
        profit: cost ? s.amount.sub(cost.toString()) : null,
      };
    })
    .sort((a, b) => a.companyName.localeCompare(b.companyName) || a.code.localeCompare(b.code));

  const kept = (l: { quantity: number; returnedQuantity: number; damagedQuantity: number }) =>
    l.quantity - l.returnedQuantity - l.damagedQuantity;
  // Deliveries only: counter sales are collected at the warehouse (no trip, no day-end).
  const deliveryOrders = orders.filter((o) => o.fulfilment === "DELIVERY");
  const counterOrders = orders.filter((o) => o.fulfilment === "COUNTER");
  const reconciled = deliveryOrders.filter((o) => o.status !== "DISPATCHED");
  const deliveries = {
    orders: deliveryOrders.length,
    delivered: deliveryOrders.filter((o) => o.status === "DELIVERED").length,
    partly: deliveryOrders.filter((o) => o.status === "PARTIALLY_DELIVERED").length,
    returned: deliveryOrders.filter((o) => o.status === "RETURNED").length,
    stillOut: deliveryOrders.filter((o) => o.status === "DISPATCHED").length,
    sent: deliveryOrders.flatMap((o) => o.lines).reduce((s, l) => s + l.quantity, 0),
    kept: reconciled.flatMap((o) => o.lines).reduce((s, l) => s + kept(l), 0),
    returnedQty: deliveryOrders.flatMap((o) => o.lines).reduce((s, l) => s + l.returnedQuantity, 0),
    damagedQty: deliveryOrders.flatMap((o) => o.lines).reduce((s, l) => s + l.damagedQuantity, 0),
    billed: sum(deliveryOrders, (o) => o.bill?.netAmount),
    list: orders
      .map((o) => ({
        id: o.id,
        number: o.number,
        customerName: o.customer.name,
        status: o.status,
        amount: o.bill?.netAmount ?? ZERO,
        counter: o.fulfilment === "COUNTER",
      }))
      .sort((a, b) => a.number - b.number),
  };

  // ── Stock: each product's movements on the day and what is left at its end ──
  const [moves, before] = await Promise.all([
    ctx.db.stockMovement.groupBy({
      by: ["productId", "type", "bucket"],
      where: { occurredAt: { gte: date, lt: next } },
      _sum: { quantity: true },
    }),
    ctx.db.stockMovement.groupBy({
      by: ["productId", "bucket"],
      where: { occurredAt: { lt: date } },
      _sum: { quantity: true },
    }),
  ]);
  const stock = products
    .map((p) => {
      const opening =
        before.find((b) => b.productId === p.id && b.bucket === "SALEABLE")?._sum.quantity ?? 0;
      const day = moves.filter((m) => m.productId === p.id);
      const of = (type: string, bucket = "SALEABLE") =>
        day.find((m) => m.type === type && m.bucket === bucket)?._sum.quantity ?? 0;
      const received = of("GOODS_RECEIPT") + of("OPENING");
      const dispatched = -of("DISPATCH");
      const returned = of("CUSTOMER_RETURN");
      const closing =
        opening +
        day.filter((m) => m.bucket === "SALEABLE").reduce((s, m) => s + (m._sum.quantity ?? 0), 0);
      // Adjustments, reversals and anything else that moved saleable stock.
      const adjusted = closing - opening - received + dispatched - returned;
      const damagedNow =
        (before.find((b) => b.productId === p.id && b.bucket === "DAMAGED")?._sum.quantity ?? 0) +
        day.filter((m) => m.bucket === "DAMAGED").reduce((s, m) => s + (m._sum.quantity ?? 0), 0);
      return {
        productId: p.id,
        code: p.code,
        name: p.name,
        companyName: companyName.get(p.companyId) ?? "",
        opening,
        received,
        dispatched,
        returned,
        adjusted,
        closing,
        damaged: damagedNow,
        low: p.minStockLevel > 0 && closing < p.minStockLevel,
      };
    })
    .filter(
      (r) =>
        r.opening ||
        r.closing ||
        r.received ||
        r.dispatched ||
        r.returned ||
        r.adjusted ||
        r.damaged,
    )
    .sort((a, b) => a.companyName.localeCompare(b.companyName) || a.code.localeCompare(b.code));

  const money = showMoney ? await moneyFor(ctx, date, next) : null;

  // ── Profit (owner / accountant): sales − cost of goods sold − expenses ──
  const salesTotal = sum(productsSold, (p) => p.amount);
  const costTotal = showCost ? sum(productsSold, (p) => p.cost) : null;
  const profit =
    showCost && costTotal && money
      ? {
          sales: salesTotal,
          cost: costTotal,
          gross: salesTotal.sub(costTotal),
          expenses: money.expenses.total,
          net: salesTotal.sub(costTotal).sub(money.expenses.total),
        }
      : null;

  const issues = dayIssues({
    date,
    stillOut: deliveries.stillOut,
    orders,
    productById,
    productsSold,
    stock,
    money,
    showCost,
  });

  return {
    date,
    showMoney,
    showCost,
    issues,
    deliveries,
    /** Counter sales billed on the day (collected at the warehouse). */
    counter: { sales: counterOrders.length, billed: sum(counterOrders, (o) => o.bill?.netAmount) },
    productsSold,
    soldTotals: {
      quantity: productsSold.reduce((s, p) => s + p.quantity, 0),
      amount: salesTotal,
      cost: costTotal,
    },
    stock,
    money,
    profit,
  };
}

async function moneyFor(ctx: ServiceCtx, date: Date, next: Date) {
  const [
    payments,
    bounced,
    expenses,
    categories,
    companyPayments,
    receipts,
    pendingRows,
    customers,
  ] = await Promise.all([
    ctx.db.customerPayment.groupBy({
      by: ["method", "collectedVia"],
      where: { paymentDate: date, status: "POSTED" },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    ctx.db.ledgerEntry.aggregate({
      where: { partyType: "CUSTOMER", type: "CHEQUE_BOUNCE", entryDate: date },
      _sum: { debit: true },
      _count: { _all: true },
    }),
    ctx.db.expense.groupBy({
      by: ["categoryId", "method"],
      where: { expenseDate: date, status: "POSTED" },
      _sum: { amount: true },
    }),
    ctx.db.expenseCategory.findMany({ select: { id: true, name: true } }),
    ctx.db.companyPayment.groupBy({
      by: ["method"],
      where: { paymentDate: date, status: "POSTED" },
      _sum: { amount: true },
    }),
    ctx.db.goodsReceipt.findMany({
      where: { receivedDate: date, status: "POSTED" },
      select: {
        number: true,
        company: { select: { name: true } },
        lines: { select: { quantity: true, amount: true } },
      },
    }),
    // What each customer owes at the end of the day.
    ctx.db.ledgerEntry.groupBy({
      by: ["customerId"],
      where: { partyType: "CUSTOMER", entryDate: { lt: next } },
      _sum: { debit: true, credit: true },
    }),
    ctx.db.customer.findMany({
      select: {
        id: true,
        name: true,
        shopName: true,
        phone: true,
        whatsapp: true,
        creditLimit: true,
      },
    }),
  ]);

  const collected = (filter: (g: (typeof payments)[number]) => boolean) =>
    sum(payments.filter(filter), (g) => g._sum.amount);
  const byMethod = (m: string) => ({
    atDelivery: collected((g) => g.method === m && g.collectedVia === "DELIVERY"),
    atOffice: collected((g) => g.method === m && g.collectedVia === "OFFICE"),
    total: collected((g) => g.method === m),
  });
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const expenseByCategory = new Map<string, Prisma.Decimal>();
  for (const e of expenses) {
    const name = catName.get(e.categoryId) ?? "";
    expenseByCategory.set(name, (expenseByCategory.get(name) ?? ZERO).add(e._sum.amount ?? ZERO));
  }
  const cashExpenses = sum(
    expenses.filter((e) => e.method === "CASH"),
    (e) => e._sum.amount,
  );
  const cashToCompanies = sum(
    companyPayments.filter((p) => p.method === "CASH"),
    (p) => p._sum.amount,
  );
  const cash = byMethod("CASH");

  const customerById = new Map(customers.map((c) => [c.id, c]));
  const owing = pendingRows
    .map((g) => {
      const c = customerById.get(g.customerId!)!;
      const balance = D(g._sum.debit ?? 0).sub(g._sum.credit ?? 0);
      return {
        customerId: g.customerId!,
        name: c.name,
        shopName: c.shopName,
        phone: c.phone,
        whatsapp: c.whatsapp,
        balance,
        overLimit: c.creditLimit !== null && balance.gt(c.creditLimit),
      };
    })
    .filter((c) => c.balance.gt(0))
    .sort((a, b) => b.balance.comparedTo(a.balance));

  return {
    collections: {
      cash,
      cheque: byMethod("CHEQUE"),
      online: byMethod("ONLINE"),
      total: collected(() => true),
      count: payments.reduce((s, g) => s + g._count._all, 0),
    },
    bounced: { amount: bounced._sum.debit ?? ZERO, count: bounced._count._all },
    expenses: {
      byCategory: [...expenseByCategory]
        .map(([name, amount]) => ({ name, amount }))
        .sort((a, b) => b.amount.comparedTo(a.amount)),
      total: sum(expenses, (e) => e._sum.amount),
    },
    companyPayments: sum(companyPayments, (p) => p._sum.amount),
    goodsReceived: receipts.map((r) => ({
      number: r.number,
      companyName: r.company.name,
      quantity: r.lines.reduce((s, l) => s + l.quantity, 0),
      amount: sum(r.lines, (l) => l.amount),
    })),
    // Cash in: collected in cash. Cash out: cash expenses and cash paid to companies.
    cashInHand: {
      in: cash.total,
      expenses: cashExpenses,
      toCompanies: cashToCompanies,
      net: cash.total.sub(cashExpenses).sub(cashToCompanies),
    },
    pending: {
      total: sum(owing, (c) => c.balance),
      customers: owing.length,
      overLimit: owing.filter((c) => c.overLimit).length,
      top: owing.slice(0, 15),
      overLimitList: owing.filter((c) => c.overLimit),
    },
  };
}

export type DailyReport = Awaited<ReturnType<typeof dailyReport>>;

export type DayIssue = {
  /** problem: something is wrong or unfinished; warning: worth a look. */
  level: "problem" | "warning";
  text: string;
  /** Where to fix it. */
  href: string;
};

const names = (list: string[], max = 3) =>
  list.length <= max
    ? list.join(", ")
    : `${list.slice(0, max).join(", ")} and ${list.length - max} more`;

/**
 * What needs attention on the day, worst first: the top of the daily report, so problems are not
 * lost in its tables.
 */
function dayIssues(d: {
  date: Date;
  stillOut: number;
  orders: {
    lines: {
      productId: string;
      quantity: number;
      returnedQuantity: number;
      damagedQuantity: number;
    }[];
  }[];
  productById: Map<string, { code: string; name: string }>;
  productsSold: { code: string; profit: Prisma.Decimal | null }[];
  stock: { code: string; closing: number; low: boolean }[];
  money: Awaited<ReturnType<typeof moneyFor>> | null;
  showCost: boolean;
}): DayIssue[] {
  const day = d.date.toISOString().slice(0, 10);
  const issues: DayIssue[] = [];
  const add = (level: DayIssue["level"], text: string, href: string) =>
    issues.push({ level, text, href });

  if (d.stillOut)
    add(
      "problem",
      `${d.stillOut} order${d.stillOut === 1 ? "" : "s"} sent out this day ${d.stillOut === 1 ? "has" : "have"} no day-end entered: returns, damage and cash are not in yet.`,
      `/delivery?tripStatus=DISPATCHED&from=${day}&to=${day}`,
    );
  if (d.money?.bounced.count)
    add(
      "problem",
      `${d.money.bounced.count} cheque${d.money.bounced.count === 1 ? "" : "s"} bounced: ${d.money.bounced.amount.toFixed(2)} is owed again.`,
      "/payments?cheque=BOUNCED",
    );
  const negative = d.stock.filter((s) => s.closing < 0);
  if (negative.length)
    add(
      "problem",
      `Stock below zero for ${names(negative.map((s) => s.code))}: a delivery or count was entered wrongly.`,
      "/inventory",
    );
  if (d.money && d.money.cashInHand.net.lt(0))
    add(
      "problem",
      `More cash went out than came in (${d.money.cashInHand.net.toFixed(2)}). Check the expenses and company payments.`,
      `/expenses?from=${day}&to=${day}`,
    );

  if (d.money?.pending.overLimitList.length)
    add(
      "warning",
      `${d.money.pending.overLimitList.length} customer${d.money.pending.overLimitList.length === 1 ? " is" : "s are"} over their credit limit: ${names(d.money.pending.overLimitList.map((c) => c.name))}.`,
      "/dashboard",
    );
  const low = d.stock.filter((s) => s.low && s.closing >= 0);
  if (low.length)
    add(
      "warning",
      `${low.length} product${low.length === 1 ? " is" : "s are"} below minimum stock: ${names(low.map((s) => s.code))}.`,
      "/inventory?level=low",
    );

  // High returns: 10% or more of what was sent, and at least half a dozen.
  const back = new Map<string, { sent: number; back: number; damaged: number }>();
  for (const o of d.orders)
    for (const l of o.lines) {
      const b = back.get(l.productId) ?? { sent: 0, back: 0, damaged: 0 };
      b.sent += l.quantity;
      b.back += l.returnedQuantity + l.damagedQuantity;
      b.damaged += l.damagedQuantity;
      back.set(l.productId, b);
    }
  const highReturns = [...back]
    .filter(([, b]) => b.sent > 0 && b.back >= 6 && b.back / b.sent >= 0.1)
    .map(
      ([id, b]) => `${d.productById.get(id)?.code ?? ""} ${Math.round((b.back / b.sent) * 100)}%`,
    );
  if (highReturns.length)
    add(
      "warning",
      `High returns or damage: ${names(highReturns, 4)} of what was sent came back.`,
      `/reports/damage?from=${day}&to=${day}`,
    );
  const damaged = [...back.values()].reduce((s, b) => s + b.damaged, 0);
  if (damaged)
    add(
      "warning",
      `${formatDozens(damaged)} damaged in delivery: settle the claims with the companies.`,
      d.money ? "/purchases/claims?claimStatus=AWAITING" : `/reports/damage?from=${day}&to=${day}`,
    );
  if (d.showCost) {
    const loss = d.productsSold.filter((p) => p.profit?.lt(0));
    if (loss.length)
      add(
        "warning",
        `Sold below cost: ${names(loss.map((p) => p.code))}. Check the sale rates and discounts.`,
        "/products",
      );
  }
  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === "problem" ? -1 : 1));
}
