import { businessToday, toDateInput } from "@/lib/dates";
import { requireTenantContext } from "@/server/auth/session";
import { ServiceError } from "@/server/services/errors";
import { defaultLedgerRange, parseDateRange } from "@/server/services/purchasing/filters";
import { getCustomerStatement } from "@/server/services/statements";
import { xBold, xlsxResponse, xMoney } from "@/server/xlsx";

/** Customer statement (all companies or one) as an Excel file, same rows as the screen. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/customers/[id]/statement/export">,
) {
  const { id } = await params;
  const ctx = await requireTenantContext("ledgers.view");
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = parseDateRange(sp);
  const range = parsed.from || parsed.to ? parsed : defaultLedgerRange(businessToday());
  let s;
  try {
    s = await getCustomerStatement(ctx, id, { ...range, companyId: sp.companyId || undefined });
  } catch (error) {
    if (error instanceof ServiceError) return new Response("Not found", { status: 404 });
    throw error;
  }
  const d = (x?: Date) => (x ? toDateInput(x) : "");
  const rows = [
    [
      xBold(
        `${s.customer.name}${s.company ? ` · ${s.company.name}` : ""} — statement ${d(range.from)} to ${d(range.to)}`,
      ),
    ],
    [],
    ["Date", "Entry", "Details", "Company", "Bills (+)", "Received (−)", "Balance due"].map(xBold),
    [
      { value: d(range.from) },
      { value: "Opening" },
      { value: "Balance brought forward" },
      null,
      null,
      null,
      xMoney(s.opening),
    ],
    ...s.rows.map((r) => [
      { value: d(r.entryDate) },
      { value: r.typeLabel },
      { value: r.description },
      { value: r.companyName },
      r.debit.isZero() ? null : xMoney(r.debit),
      r.credit.isZero() ? null : xMoney(r.credit),
      xMoney(r.balance),
    ]),
    [{ value: d(range.to) }, { value: "Closing" }, null, null, null, null, xMoney(s.closing)],
  ];
  return xlsxResponse(rows, [12, 16, 46, 20, 14, 14, 16], `${s.customer.name}-statement`);
}
