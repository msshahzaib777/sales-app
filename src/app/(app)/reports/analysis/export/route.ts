import { PERIOD_KINDS, type PeriodKind } from "@/lib/analysis";
import { businessToday } from "@/lib/dates";
import { requireTenantContext } from "@/server/auth/session";
import { parseDateRange } from "@/server/services/purchasing/filters";
import { businessAnalysis } from "@/server/services/reports/analysis";
import { xBold, xlsxResponse, xMoney } from "@/server/xlsx";

/** The business analysis as an Excel file: the same sections as the page, one after another. */
export async function GET(request: Request) {
  const ctx = await requireTenantContext("operations.manage");
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const kind: PeriodKind = PERIOD_KINDS.includes(sp.period as PeriodKind)
    ? (sp.period as PeriodKind)
    : "month";
  const date = parseDateRange({ from: sp.date }).from ?? businessToday();
  const a = await businessAnalysis(ctx, kind, date);
  const pct = (v: number | null) => ({ value: v === null ? "" : `${v.toFixed(0)}%` });
  const blank: null[] = [];
  const rows: Parameters<typeof xlsxResponse>[0] = [
    [xBold(`Business analysis ${a.current.label} (compared with ${a.previous.label})`)],
    blank,
    [
      xBold("Trend"),
      xBold("Sales"),
      xBold("Orders"),
      ...(a.showCost ? [xBold("Gross profit"), xBold("Net profit")] : []),
    ],
    ...a.trend.map((t) => [
      { value: t.label },
      xMoney(t.sales),
      { value: t.orders },
      ...(a.showCost ? [xMoney(t.gross!), xMoney(t.net!)] : []),
    ]),
    blank,
    [xBold("Products")],
    [
      "Code",
      "Product",
      "Company",
      "Packets sold",
      "Packets before",
      "Change",
      "Sales",
      ...(a.showCost ? ["Profit"] : []),
      "Returned %",
      "Trend",
    ].map(xBold),
    ...a.products.rows.map((r) => [
      { value: r.code },
      { value: r.name },
      { value: r.companyName },
      { value: r.qty.current.toNumber() },
      { value: r.qty.previous.toNumber() },
      pct(r.qty.change),
      xMoney(r.amount.current),
      ...(a.showCost ? [r.profit ? xMoney(r.profit) : null] : []),
      pct(r.returnRate),
      { value: r.trend },
    ]),
  ];
  if (a.companies) {
    rows.push(
      blank,
      [xBold("Companies")],
      [
        "Company",
        "Sales",
        "Change",
        "Cost",
        "Gross profit",
        "Margin",
        "Damage claimed",
        "We owe now",
      ].map(xBold),
      ...a.companies.map((c) => [
        { value: c.name },
        xMoney(c.sales.current),
        pct(c.sales.change),
        xMoney(c.cost),
        xMoney(c.gross.current),
        pct(c.margin),
        xMoney(c.damageClaimed),
        xMoney(c.payableNow),
      ]),
    );
  }
  if (a.customers) {
    rows.push(
      blank,
      [xBold("Customers")],
      [
        "Customer",
        "Shop",
        "Phone",
        "Bought",
        "Before",
        "Paid",
        "Days to pay",
        "Oldest unpaid (days)",
        "Owes now",
        "Trend",
        "Pays late",
        "Bounced",
      ].map(xBold),
      ...a.customers.rows.map((r) => [
        { value: r.name },
        { value: r.shopName ?? "" },
        { value: r.phone ?? "" },
        xMoney(r.bought.current),
        xMoney(r.bought.previous),
        xMoney(r.paid),
        { value: r.avgDaysToPay === null ? "" : Math.round(r.avgDaysToPay) },
        { value: r.oldestUnpaidDays ?? "" },
        xMoney(r.balance),
        { value: r.trend },
        { value: r.late ? "yes" : "" },
        { value: r.bounced || "" },
      ]),
    );
  }
  return xlsxResponse(
    rows,
    [26, 26, 20, 14, 14, 12, 14, 14, 14, 12, 10, 10],
    `analysis-${kind}-${a.current.label.replace(/\s+/g, "-")}`,
  );
}
