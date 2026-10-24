import "server-only";

import { businessToday, toDateInput } from "@/lib/dates";
import type { CustomerInput, ProductInput } from "@/lib/validation/master";

import { assertCan } from "../../auth/permissions";
import { ServiceError } from "../errors";
import type { ServiceCtx } from "./common";
import { createCustomerTx } from "./customers";
import {
  customerKey,
  type ImportKind,
  type PreviewRow,
  readTable,
  validateCustomerRows,
  validateProductRows,
  type ValidatedRow,
} from "./import-rows";
import { createProductTx, updateProductTx } from "./products";

// Excel/CSV import for products and customers: preview first (nothing saved), then import the
// valid rows in one transaction. The commit re-reads and re-validates the file on the server; it
// never trusts the preview sent back from the browser.

export type ImportFile = { name: string; bytes: Buffer };

export type ImportPreview = {
  kind: ImportKind;
  fileName: string;
  totalRows: number;
  newCount: number;
  updateCount: number;
  errorCount: number;
  rows: PreviewRow[];
};

const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

async function validate(ctx: ServiceCtx, kind: ImportKind, file: ImportFile) {
  assertCan(ctx.user.role, "masterData.manage");
  if (kind === "products") assertCan(ctx.user.role, "rates.manage");
  const table = await readTable(file.name, file.bytes);
  const companies = await ctx.db.company.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  const companyMap = new Map(companies.map((c) => [nameKey(c.name), c.id]));

  if (kind === "products") {
    const products = await ctx.db.product.findMany({ select: { id: true, code: true } });
    return validateProductRows(table, {
      companies: companyMap,
      existingCodes: new Map(products.map((p) => [p.code, p.id])),
      today: toDateInput(businessToday()),
    });
  }
  const [areas, customers] = await Promise.all([
    ctx.db.area.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    ctx.db.customer.findMany({ select: { name: true, phone: true } }),
  ]);
  const areaMap = new Map<string, string>();
  for (const a of areas) {
    // The same area name in two warehouses is ambiguous; leave it out so the row reports it.
    const key = nameKey(a.name);
    if (areaMap.has(key)) areaMap.set(key, "");
    else areaMap.set(key, a.id);
  }
  for (const [k, v] of areaMap) if (!v) areaMap.delete(k);
  return validateCustomerRows(table, {
    areas: areaMap,
    companies: companyMap,
    existingKeys: new Set(customers.map((c) => customerKey(c.name, c.phone))),
  });
}

function summarize(
  kind: ImportKind,
  fileName: string,
  rows: ValidatedRow<unknown>[],
): ImportPreview {
  return {
    kind,
    fileName,
    totalRows: rows.length,
    newCount: rows.filter((r) => r.status === "new").length,
    updateCount: rows.filter((r) => r.status === "update").length,
    errorCount: rows.filter((r) => r.status === "error").length,
    rows: rows.map(({ line, values, status, errors }) => ({ line, values, status, errors })),
  };
}

export async function previewImport(
  ctx: ServiceCtx,
  kind: ImportKind,
  file: ImportFile,
): Promise<ImportPreview> {
  return summarize(kind, file.name, await validate(ctx, kind, file));
}

/**
 * Imports the valid rows (rows with errors are skipped) in one transaction. `requestId` makes a
 * retried import harmless: rows already created by it are found again instead of duplicated.
 */
export async function commitImport(
  ctx: ServiceCtx,
  kind: ImportKind,
  file: ImportFile,
  requestId: string,
) {
  const rows = await validate(ctx, kind, file);
  const valid = rows.filter((r) => r.status !== "error");
  if (valid.length === 0) throw new ServiceError("There are no valid rows to import.");

  let created = 0;
  let updated = 0;
  await ctx.db.$transaction(
    async (tx) => {
      for (const row of valid) {
        const rowRequestId = `${requestId}:${row.line}`;
        if (kind === "products") {
          const input = row.input as ProductInput;
          if (row.existingId) {
            const result = await updateProductTx(tx, ctx, row.existingId, input);
            if (result.changed) updated++;
          } else {
            await createProductTx(tx, ctx, input, rowRequestId);
            created++;
          }
        } else {
          await createCustomerTx(tx, ctx, row.input as CustomerInput, rowRequestId);
          created++;
        }
      }
    },
    { timeout: 120_000 },
  );
  return { created, updated, skipped: rows.length - valid.length };
}
