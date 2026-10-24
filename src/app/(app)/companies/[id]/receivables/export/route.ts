import { businessToday, toDateInput } from "@/lib/dates";
import { requireTenantContext } from "@/server/auth/session";
import { ServiceError } from "@/server/services/errors";
import { defaultLedgerRange, parseDateRange } from "@/server/services/purchasing/filters";
import { getCompanyReceivables } from "@/server/services/statements";
import { xBold, xlsxResponse, xMoney } from "@/server/xlsx";

/** What every customer owes for one company's products, as an Excel file. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/companies/[id]/receivables/export">,
) {
  const { id } = await params;
  const ctx = await requireTenantContext("ledgers.view");
  const parsed = parseDateRange(Object.fromEntries(new URL(request.url).searchParams));
  const range = parsed.from || parsed.to ? parsed : defaultLedgerRange(businessToday());
  let r;
  try {
    r = await getCompanyReceivables(ctx, id, range);
  } catch (error) {
    if (error instanceof ServiceError) return new Response("Not found", { status: 404 });
    throw error;
  }
  const d = (x?: Date) => (x ? toDateInput(x) : "");
  const rows = [
    [xBold(`${r.company.name} — customer balances ${d(range.from)} to ${d(range.to)}`)],
    [],
    ["Customer", "Shop", "Area", "Opening", "Bills (+)", "Received (−)", "Owes"].map(xBold),
    ...r.rows.map((x) => [
      { value: x.name },
      { value: x.shopName ?? "" },
      { value: x.areaName ?? "" },
      xMoney(x.opening),
      xMoney(x.debit),
      xMoney(x.credit),
      xMoney(x.closing),
    ]),
    [
      xBold("Total"),
      null,
      null,
      xMoney(r.totals.opening),
      xMoney(r.totals.debit),
      xMoney(r.totals.credit),
      xMoney(r.totals.closing),
    ],
  ];
  return xlsxResponse(rows, [24, 24, 16, 14, 14, 14, 14], `${r.company.name}-customer-balances`);
}
