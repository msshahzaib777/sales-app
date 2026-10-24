import { toDateInput } from "@/lib/dates";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import {
  CLAIM_STATUS_LABEL,
  damageReport,
  parseDamageFilters,
} from "@/server/services/reports/damage";
import { xBold, xlsxResponse, xMoney } from "@/server/xlsx";

/** The damage report as an Excel file: same filters and rows as the screen. */
export async function GET(request: Request) {
  const ctx = await requireTenantContext("operations.manage");
  const f = parseDamageFilters(Object.fromEntries(new URL(request.url).searchParams));
  const r = await damageReport(ctx, f);
  const d = (x?: Date) => (x ? toDateInput(x) : "");
  const head = ["Date", "Trip", "Driver", "Order", "Customer", "Product", "Company"];
  const rows = [
    [xBold(`Damage report ${d(f.from)} to ${d(f.to)}`)],
    [],
    [
      ...head,
      "Damaged (packets)",
      "Damaged",
      ...(r.showValue ? ["Claimed", "Claim", "Accepted"] : []),
    ].map(xBold),
    ...r.rows.map((x) => [
      { value: d(x.tripDate) },
      { value: x.tripNumber },
      { value: x.driverName },
      { value: x.orderNumber },
      { value: x.customerName },
      { value: `${x.productCode} ${x.productName}` },
      { value: x.companyName },
      { value: x.quantity },
      { value: formatDozens(x.quantity) },
      ...(r.showValue
        ? [
            x.claim ? xMoney(x.claim.claimed) : null,
            x.claim ? { value: CLAIM_STATUS_LABEL[x.claim.status] } : null,
            x.claim?.accepted ? xMoney(x.claim.accepted) : null,
          ]
        : []),
    ]),
    [
      xBold("Total"),
      null,
      null,
      null,
      null,
      null,
      null,
      { value: r.totals.quantity, fontWeight: "bold" as const },
      xBold(formatDozens(r.totals.quantity)),
      ...(r.showValue ? [xMoney(r.totals.claimed), null, xMoney(r.totals.accepted)] : []),
    ],
  ];
  return xlsxResponse(
    rows,
    [12, 8, 16, 8, 22, 28, 20, 12, 12, ...(r.showValue ? [12, 12, 12] : [])],
    `damage-report-${d(f.from)}`,
  );
}
