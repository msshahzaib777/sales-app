import writeXlsxFile from "write-excel-file/node";

import { requireTenantContext } from "@/server/auth/session";
import { importSheetData } from "@/server/services/master/import";
import { IMPORT_KINDS, type ImportKind } from "@/server/services/master/import-rows";

/**
 * The sample sheet for one import, as an Excel file: "Import" (the columns, with example rows that
 * are never imported) and "How to fill" (the rules and the names this business already has).
 */
export async function GET(_request: Request, { params }: RouteContext<"/import/template/[kind]">) {
  const { kind } = await params;
  if (!(IMPORT_KINDS as readonly string[]).includes(kind))
    return new Response("Unknown import.", { status: 404 });
  const ctx = await requireTenantContext("masterData.manage");
  const sheet = await importSheetData(ctx, kind as ImportKind);

  const bold = (value: string) => ({ value, fontWeight: "bold" as const });
  const example = (value: string) => ({ value, type: String, color: "#6b6b6b" });
  const buffer = await writeXlsxFile([
    {
      sheet: "Import",
      data: [sheet.headers.map(bold), ...sheet.examples.map((row) => row.map(example))],
      columns: sheet.headers.map((h) => ({ width: Math.max(14, h.length + 4) })),
      stickyRowsCount: 1,
    },
    {
      sheet: "How to fill",
      data: [
        [bold(sheet.title)],
        [{ value: "" }],
        ...sheet.notes.map((n) => [{ value: `• ${n}` }]),
        [{ value: "" }],
        ...sheet.choices.flatMap((c) => [
          [bold(c.label)],
          ...(c.values.length ? c.values : ["(none yet)"]).map((v) => [{ value: v }]),
          [{ value: "" }],
        ]),
      ],
      columns: [{ width: 110 }],
    },
  ]).toBuffer();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="taqseem-${kind}-import.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
