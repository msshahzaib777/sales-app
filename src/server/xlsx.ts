import "server-only";

import writeXlsxFile, { type SheetData } from "write-excel-file/node";

// Small helpers for the Excel downloads of ledgers and statements.

export const xMoney = (v: { toString(): string }) => ({
  value: Number(v.toString()),
  type: Number,
  format: "#,##0.00",
});
export const xBold = (value: string) => ({ value, fontWeight: "bold" as const });

export async function xlsxResponse(rows: SheetData, widths: number[], name: string) {
  const buffer = await writeXlsxFile(rows, {
    columns: widths.map((width) => ({ width })),
  }).toBuffer();
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name.replace(/[^\w-]+/g, "-")}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
