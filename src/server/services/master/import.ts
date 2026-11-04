import "server-only";

import { businessToday, toDateInput } from "@/lib/dates";
import type { AreaInput, CompanyInput, CustomerInput, ProductInput } from "@/lib/validation/master";

import { assertCan } from "../../auth/permissions";
import { ServiceError } from "../errors";
import type { ServiceCtx } from "./common";
import { createAreaTx } from "./areas";
import { createCompanyTx } from "./companies";
import { createCustomerTx } from "./customers";
import {
  customerKey,
  EXAMPLE_MARK,
  IMPORT_NOTES,
  type ImportKind,
  type PreviewRow,
  readTable,
  validateAreaRows,
  validateCompanyRows,
  validateCustomerRows,
  validateProductRows,
  templateExamples,
  templateHeaders,
  type ValidatedRow,
} from "./import-rows";
import { createProductTx, updateProductTx } from "./products";

// Excel/CSV import for companies, products, areas and customers: preview first (nothing saved), then import the
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
  if (kind === "companies" || kind === "areas") {
    const warehouses = await ctx.db.warehouse.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    });
    const warehouseMap = new Map(warehouses.map((w) => [nameKey(w.name), w.id]));
    if (kind === "companies") {
      const existing = await ctx.db.company.findMany({ select: { name: true } });
      return validateCompanyRows(table, {
        warehouses: warehouseMap,
        existingNames: new Set(existing.map((c) => nameKey(c.name))),
      });
    }
    const existing = await ctx.db.area.findMany({ select: { warehouseId: true, name: true } });
    return validateAreaRows(table, {
      warehouses: warehouseMap,
      existingKeys: new Set(existing.map((a) => `${a.warehouseId}|${nameKey(a.name)}`)),
    });
  }
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
        } else if (kind === "companies") {
          await createCompanyTx(tx, ctx, {
            ...(row.input as CompanyInput),
            requestId: rowRequestId,
          });
          created++;
        } else if (kind === "areas") {
          await createAreaTx(tx, ctx, { ...(row.input as AreaInput), requestId: rowRequestId });
          created++;
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

const TITLES: Record<ImportKind, string> = {
  companies: "Import companies",
  products: "Import products",
  areas: "Import areas / routes",
  customers: "Import customers (clients)",
};

/** Everything the sample sheet shows: columns, example rows, rules and this business's names. */
export async function importSheetData(ctx: ServiceCtx, kind: ImportKind) {
  assertCan(ctx.user.role, "masterData.manage");
  const [warehouses, companies, areas] = await Promise.all([
    ctx.db.warehouse.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    ctx.db.company.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    ctx.db.area.findMany({
      where: { isActive: true },
      orderBy: [{ warehouse: { name: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
      include: { warehouse: { select: { name: true } } },
    }),
  ]);
  const companyNames = companies.map((c) => c.name);
  const choices: { label: string; values: string[] }[] = [];
  if (kind === "companies" || kind === "areas")
    choices.push({ label: "Warehouse: one of", values: warehouses.map((w) => w.name) });
  if (kind === "products") choices.push({ label: "Company: one of", values: companyNames });
  if (kind === "customers") {
    choices.push(
      { label: "Type: one of", values: ["Retailer", "Wholesaler", "Dealer", "Bike supplier"] },
      { label: "Area: one of", values: areas.map((a) => `${a.name}   (${a.warehouse.name})`) },
    );
  }
  return {
    title: TITLES[kind],
    headers: templateHeaders(kind, kind === "customers" ? companyNames : []),
    examples: templateExamples(kind, {
      warehouse: warehouses[0]?.name,
      company: companies[0]?.name,
      area: areas[0]?.name,
      companies: companyNames,
    }),
    notes: [
      `Fill in the "Import" sheet: one row per record under the header row. Rows starting with ${EXAMPLE_MARK} are examples and are never imported; delete them or leave them.`,
      ...IMPORT_NOTES[kind],
      "Then open Taqseem → Import from Excel, choose this file and press Check file. Nothing is saved until you press Import.",
    ],
    choices,
  };
}
