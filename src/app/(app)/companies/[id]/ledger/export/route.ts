import writeXlsxFile from "write-excel-file/node";

import { businessToday, toDateInput } from "@/lib/dates";
import { requireTenantContext } from "@/server/auth/session";
import { getCompanyLedger } from "@/server/services/purchasing/company-ledger";
import { defaultLedgerRange, parseDateRange } from "@/server/services/purchasing/filters";
import { ServiceError } from "@/server/services/errors";

/** Company ledger as an Excel file, same period and rows as the screen. */
export async function GET(
  request: Request,
  { params }: RouteContext<"/companies/[id]/ledger/export">,
) {
  const { id } = await params;
  const ctx = await requireTenantContext("ledgers.view");
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = parseDateRange(sp);
  const range = parsed.from || parsed.to ? parsed : defaultLedgerRange(businessToday());

  let ledger;
  try {
    ledger = await getCompanyLedger(ctx, id, range);
  } catch (error) {
    if (error instanceof ServiceError) return new Response("Not found", { status: 404 });
    throw error;
  }

  const money = (v: { toString(): string }) => ({
    value: Number(v.toString()),
    type: Number,
    format: "#,##0.00",
  });
  const header = [
    "Date",
    "Entry",
    "Details",
    "Bills (+)",
    "Paid / credit (−)",
    "Balance (we owe)",
  ].map((value) => ({ value, fontWeight: "bold" as const }));
  const rows = [
    [
      {
        value: `${ledger.company.name} — ledger ${range.from ? toDateInput(range.from) : ""} to ${range.to ? toDateInput(range.to) : ""}`,
        fontWeight: "bold" as const,
      },
    ],
    [],
    header,
    [
      { value: range.from ? toDateInput(range.from) : "" },
      { value: "Opening" },
      { value: "Balance brought forward" },
      null,
      null,
      money(ledger.opening),
    ],
    ...ledger.rows.map((r) => [
      { value: toDateInput(r.entryDate) },
      { value: r.typeLabel },
      { value: r.description },
      r.credit.isZero() ? null : money(r.credit),
      r.debit.isZero() ? null : money(r.debit),
      money(r.balance),
    ]),
    [
      { value: range.to ? toDateInput(range.to) : "" },
      { value: "Closing" },
      null,
      null,
      null,
      money(ledger.closing),
    ],
  ];
  const buffer = await writeXlsxFile(rows, {
    columns: [
      { width: 12 },
      { width: 16 },
      { width: 50 },
      { width: 14 },
      { width: 16 },
      { width: 18 },
    ],
  }).toBuffer();
  const fileName = `${ledger.company.name.replace(/[^\w-]+/g, "-")}-ledger.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
