import { businessToday, toDateInput } from "@/lib/dates";
import { listParamsSchema } from "@/lib/list-params";
import { requireTenantContext } from "@/server/auth/session";
import { exportCustomers } from "@/server/services/master/customers";
import { customerExportTable } from "@/server/services/master/import-rows";
import { xBold, xlsxResponse } from "@/server/xlsx";

/**
 * The customers the list shows (same search and filters), as an Excel file in the customer
 * import's layout, so another Taqseem can import it: Customers → Import there.
 */
export async function GET(request: Request) {
  const ctx = await requireTenantContext("masterData.manage");
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const table = customerExportTable(await exportCustomers(ctx, listParamsSchema.parse(sp), sp));
  return xlsxResponse(
    [
      table.headers.map(xBold),
      ...table.rows.map((row) =>
        row.map((value) =>
          value === null
            ? null
            : typeof value === "number"
              ? { value, type: Number }
              : { value, type: String },
        ),
      ),
    ],
    [26, 26, 14, 16, 16, 34, 20, 18, 10, 14],
    `customers-${toDateInput(businessToday())}`,
  );
}
