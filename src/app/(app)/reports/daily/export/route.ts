import { businessToday, toDateInput } from "@/lib/dates";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import { parseDateRange } from "@/server/services/purchasing/filters";
import { dailyReport } from "@/server/services/reports/daily";
import { xBold, xlsxResponse, xMoney } from "@/server/xlsx";

/** The daily report as an Excel file: the same sections as the page, one after another. */
export async function GET(request: Request) {
  const ctx = await requireTenantContext("operations.manage");
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const date = parseDateRange({ from: sp.date }).from ?? businessToday();
  const r = await dailyReport(ctx, date);
  const blank: null[] = [];
  const rows: Parameters<typeof xlsxResponse>[0] = [
    [xBold(`Daily report ${toDateInput(date)}`)],
    blank,
    [xBold("Key numbers")],
    [{ value: "Sold (billed)" }, xMoney(r.soldTotals.amount)],
    [{ value: "Orders billed" }, { value: r.deliveries.orders }],
    [{ value: "Day-end not entered" }, { value: r.deliveries.stillOut }],
  ];
  if (r.money) {
    rows.push(
      [{ value: "Received from customers" }, xMoney(r.money.collections.total)],
      [{ value: "  cash" }, xMoney(r.money.collections.cash.total)],
      [{ value: "  cheque" }, xMoney(r.money.collections.cheque.total)],
      [{ value: "  online" }, xMoney(r.money.collections.online.total)],
      [{ value: "Cheques bounced" }, xMoney(r.money.bounced.amount)],
      [{ value: "Expenses" }, xMoney(r.money.expenses.total)],
      [{ value: "Paid to companies" }, xMoney(r.money.companyPayments)],
      [{ value: "Cash in hand (today)" }, xMoney(r.money.cashInHand.net)],
      [{ value: "Customers owe (end of day)" }, xMoney(r.money.pending.total)],
    );
  }
  if (r.profit) {
    rows.push(
      [{ value: "Cost of goods sold" }, xMoney(r.profit.cost)],
      [{ value: "Gross profit" }, xMoney(r.profit.gross)],
      [{ value: "Net profit" }, xMoney(r.profit.net)],
    );
  }
  rows.push(
    blank,
    [xBold("Products sold")],
    [
      "Code",
      "Product",
      "Company",
      "Packets",
      "Quantity",
      "Sales",
      ...(r.showCost ? ["Cost", "Profit"] : []),
    ].map(xBold),
    ...r.productsSold.map((p) => [
      { value: p.code },
      { value: p.name },
      { value: p.companyName },
      { value: p.quantity },
      { value: formatDozens(p.quantity) },
      xMoney(p.amount),
      ...(r.showCost ? [p.cost ? xMoney(p.cost) : null, p.profit ? xMoney(p.profit) : null] : []),
    ]),
    blank,
    [xBold("Orders")],
    ["Order", "Customer", "Status", "Bill"].map(xBold),
    ...r.deliveries.list.map((o) => [
      { value: o.number },
      { value: o.customerName },
      { value: o.status },
      xMoney(o.amount),
    ]),
  );
  if (r.money) {
    rows.push(
      blank,
      [xBold("Customers owe (end of day)")],
      ["Customer", "Shop", "Phone", "WhatsApp", "Owes"].map(xBold),
      ...r.money.pending.top.map((c) => [
        { value: c.name },
        { value: c.shopName ?? "" },
        { value: c.phone ?? "" },
        { value: c.whatsapp ?? "" },
        xMoney(c.balance),
      ]),
      blank,
      [xBold("Expenses")],
      ...r.money.expenses.byCategory.map((e) => [{ value: e.name }, xMoney(e.amount)]),
    );
  }
  rows.push(
    blank,
    [xBold("Stock (packets)")],
    [
      "Code",
      "Product",
      "Opening",
      "Received",
      "Sent out",
      "Returned",
      "Adjusted",
      "Closing",
      "Damaged",
    ].map(xBold),
    ...r.stock.map((s) => [
      { value: s.code },
      { value: s.name },
      { value: s.opening },
      { value: s.received },
      { value: s.dispatched },
      { value: s.returned },
      { value: s.adjusted },
      { value: s.closing },
      { value: s.damaged },
    ]),
  );
  return xlsxResponse(
    rows,
    [26, 26, 20, 12, 12, 14, 14, 12, 12],
    `daily-report-${toDateInput(date)}`,
  );
}
