import { Prisma } from "@/generated/prisma/client";
import { toDateInput } from "@/lib/dates";
import { PAYMENT_METHOD_LABEL } from "@/lib/expenses";
import { filterParam } from "@/lib/list-params";
import { requireTenantContext } from "@/server/auth/session";
import { exportExpenses } from "@/server/services/expenses";
import { parseDateRange } from "@/server/services/purchasing/filters";
import { xBold, xlsxResponse, xMoney } from "@/server/xlsx";

/** Expenses as an Excel file, with the same filters as the list. */
export async function GET(request: Request) {
  const ctx = await requireTenantContext("expenses.manage");
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const range = parseDateRange(sp);
  const rows = await exportExpenses(ctx, {
    q: filterParam(sp, "q"),
    categoryId: filterParam(sp, "categoryId"),
    method: filterParam(sp, "method"),
    warehouseId: filterParam(sp, "warehouseId"),
    bikeId: filterParam(sp, "bikeId"),
    status: filterParam(sp, "expenseStatus"),
    ...range,
  });
  const d = (x?: Date) => (x ? toDateInput(x) : "");
  const posted = rows.filter((r) => r.status === "POSTED");
  const total = posted.reduce((s, r) => s.add(r.amount), new Prisma.Decimal(0));
  return xlsxResponse(
    [
      [xBold(`Expenses ${d(range.from) || "…"} to ${d(range.to) || "…"}`)],
      [],
      [
        "No.",
        "Date",
        "Category",
        "Amount",
        "Paid by",
        "Paid to",
        "Note",
        "Warehouse",
        "Bike",
        "Trip",
        "Staff",
        "Status",
      ].map(xBold),
      ...rows.map((r) => [
        { value: r.number },
        { value: d(r.expenseDate) },
        { value: r.category.name },
        xMoney(r.amount),
        { value: PAYMENT_METHOD_LABEL[r.method] },
        { value: r.paidTo ?? "" },
        { value: r.note ?? "" },
        { value: r.warehouse?.name ?? "" },
        { value: r.bike?.name ?? "" },
        r.trip ? { value: r.trip.number } : null,
        { value: r.staff?.name ?? "" },
        { value: r.status === "POSTED" ? "Posted" : `Reversed: ${r.reversalReason ?? ""}` },
      ]),
      [null, null, xBold("Total (posted)"), xMoney(total)],
    ],
    [7, 12, 20, 14, 10, 22, 30, 14, 12, 7, 16, 24],
    `expenses-${d(range.from) || "all"}`,
  );
}
