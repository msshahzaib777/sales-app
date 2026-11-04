import { toDateInput } from "@/lib/dates";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import { productsSold, soldParams } from "@/server/services/reports/products-sold";
import { xBold, xlsxResponse, xMoney } from "@/server/xlsx";

/** Products sold as an Excel file: the same rows as the page. */
export async function GET(request: Request) {
  const ctx = await requireTenantContext("reports.productsSold");
  const q = soldParams(Object.fromEntries(new URL(request.url).searchParams));
  const r = await productsSold(ctx, { from: q.from, to: q.to, companyId: q.companyId });
  const company = r.companies.find((c) => c.id === q.companyId);
  const head = ["Code", "Product", "Company", "Sold", "At counter", "Bills", "Customers"];
  const rows: Parameters<typeof xlsxResponse>[0] = [
    [
      xBold(
        `Products sold ${toDateInput(r.from)} to ${toDateInput(r.to)}${company ? ` · ${company.name}` : ""}`,
      ),
    ],
    [],
    [...head, "Days sold", ...(r.showAmounts ? ["Sales"] : [])].map(xBold),
    ...r.rows.map((p) => [
      { value: p.code },
      { value: p.name },
      { value: p.companyName },
      { value: formatDozens(p.quantity) },
      { value: p.counter ? formatDozens(p.counter) : "" },
      { value: p.bills },
      { value: p.customers },
      { value: p.days },
      ...(r.showAmounts ? [xMoney(p.amount!)] : []),
    ]),
    [
      xBold("Total"),
      null,
      null,
      xBold(formatDozens(r.totals.quantity)),
      { value: r.totals.counter ? formatDozens(r.totals.counter) : "" },
      null,
      null,
      null,
      ...(r.showAmounts ? [xMoney(r.totals.amount!)] : []),
    ],
  ];
  return xlsxResponse(
    rows,
    [10, 30, 22, 12, 12, 8, 10, 10, 14],
    `products-sold-${toDateInput(r.from)}-${toDateInput(r.to)}`,
  );
}
