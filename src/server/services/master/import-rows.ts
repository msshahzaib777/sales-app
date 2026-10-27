import { normalizePkPhone } from "@/lib/phone";
import Papa from "papaparse";
import { readSheet } from "read-excel-file/node";
import type { ZodError } from "zod";

import {
  CUSTOMER_TYPES,
  type CustomerInput,
  customerSchema,
  type ProductInput,
  productSchema,
} from "@/lib/validation/master";

import { ServiceError } from "../errors";

// Excel/CSV import: reading files and validating rows. No database access here, so the rules are
// unit-tested; the service (import.ts) supplies lookups and saves the valid rows.

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 2000;

export type ImportKind = "products" | "customers";

export type Table = { headers: string[]; rows: string[][] };

/** Cell → text. Excel numbers lose leading zeros, so 10-digit mobile numbers get their 0 back. */
function cellText(value: unknown, header: string): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const text = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
    if (/phone|whatsapp/i.test(header) && /^3\d{9}$/.test(text)) return `0${text}`;
    return text;
  }
  return String(value).trim();
}

/** Reads the first sheet of an .xlsx file, or a .csv file, into header + rows of text. */
export async function readTable(fileName: string, bytes: Buffer): Promise<Table> {
  if (bytes.length === 0) throw new ServiceError("The file is empty.");
  if (bytes.length > MAX_IMPORT_BYTES)
    throw new ServiceError("The file is larger than 2 MB. Split it into smaller files.");

  let raw: unknown[][];
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx")) {
    try {
      raw = await readSheet(bytes);
    } catch {
      throw new ServiceError(
        "This Excel file could not be read. Save it as .xlsx (Excel Workbook) or .csv and try again.",
      );
    }
  } else if (lower.endsWith(".csv")) {
    const parsed = Papa.parse<string[]>(bytes.toString("utf8").replace(/^﻿/, ""), {
      skipEmptyLines: "greedy",
    });
    raw = parsed.data;
  } else {
    throw new ServiceError("Upload an Excel (.xlsx) or CSV (.csv) file.");
  }

  const nonEmpty = raw.filter((row) => row.some((cell) => cellText(cell, "") !== ""));
  if (nonEmpty.length < 2)
    throw new ServiceError("The file has no data rows under the header row.");
  const headers = nonEmpty[0]!.map((h) => cellText(h, ""));
  const rows = nonEmpty.slice(1).map((row) => headers.map((h, i) => cellText(row[i], h)));
  if (rows.length > MAX_IMPORT_ROWS)
    throw new ServiceError(
      `The file has more than ${MAX_IMPORT_ROWS} rows. Split it into smaller files.`,
    );
  return { headers, rows };
}

const normalize = (header: string) =>
  header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export type PreviewRow = {
  /** Spreadsheet row number (header is row 1). */
  line: number;
  values: Record<string, string>;
  status: "new" | "update" | "error";
  errors: string[];
};

export type ValidatedRow<T> = PreviewRow & { input?: T; existingId?: string };

/** Column definition: the label in the template and accepted header spellings. */
type Column = { key: string; label: string; required?: boolean; aliases?: string[] };

function columnIndex(headers: string[], columns: Column[]) {
  const normalized = headers.map(normalize);
  const index: Record<string, number> = {};
  const missing: string[] = [];
  for (const col of columns) {
    const names = [col.label, col.key, ...(col.aliases ?? [])].map(normalize);
    const i = normalized.findIndex((h) => names.includes(h));
    if (i >= 0) index[col.key] = i;
    else if (col.required) missing.push(col.label);
  }
  if (missing.length > 0) {
    throw new ServiceError(
      `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the template to see the expected columns.`,
    );
  }
  return index;
}

/** Zod issues → messages naming the spreadsheet column. */
function issueMessages(error: ZodError, labels: Record<string, string>): string[] {
  return error.issues.map((issue) => {
    const field = String(issue.path[0] ?? "");
    const label = labels[field] ?? field;
    return label ? `${label}: ${issue.message}` : issue.message;
  });
}

// ───────────────────────── Products ─────────────────────────

export const PRODUCT_COLUMNS: Column[] = [
  { key: "code", label: "Code", required: true, aliases: ["short code", "product code"] },
  { key: "name", label: "Name", required: true, aliases: ["product", "product name"] },
  { key: "company", label: "Company", required: true, aliases: ["company name", "supplier"] },
  {
    key: "purchaseRate",
    label: "Purchase rate",
    required: true,
    aliases: ["purchase rate per dozen", "cost"],
  },
  { key: "saleRate", label: "Sale rate", required: true, aliases: ["sale rate per dozen", "rate"] },
  {
    key: "discountPerDozen",
    label: "Discount per dozen",
    aliases: ["discount", "company discount"],
  },
  {
    key: "minStockDozens",
    label: "Minimum stock (dozens)",
    aliases: ["minimum stock", "min stock", "min stock dozens"],
  },
];

const PRODUCT_LABELS: Record<string, string> = {
  code: "Code",
  name: "Name",
  companyId: "Company",
  purchaseRate: "Purchase rate",
  saleRate: "Sale rate",
  discountValue: "Discount per dozen",
  discountType: "Discount per dozen",
  minStockLevel: "Minimum stock (dozens)",
};

export type ProductLookups = {
  /** Lower-cased company name → id (active companies). */
  companies: Map<string, string>;
  /** Upper-cased product code → existing product id. */
  existingCodes: Map<string, string>;
  /** Business date the imported rates take effect. */
  today: string;
};

export function validateProductRows(
  table: Table,
  lookups: ProductLookups,
): ValidatedRow<ProductInput>[] {
  const index = columnIndex(table.headers, PRODUCT_COLUMNS);
  const seenCodes = new Set<string>();

  return table.rows.map((row, i) => {
    const get = (key: string) => (index[key] === undefined ? "" : (row[index[key]!] ?? ""));
    const values = Object.fromEntries(PRODUCT_COLUMNS.map((c) => [c.label, get(c.key)]));
    const errors: string[] = [];

    const companyId = lookups.companies.get(nameKey(get("company")));
    if (get("company") && !companyId)
      errors.push(`Company: "${get("company")}" is not an active company`);

    const discount = get("discountPerDozen").replace(/,/g, "");
    const parsed = productSchema.safeParse({
      companyId: companyId ?? "unknown",
      code: get("code"),
      name: get("name"),
      purchaseRate: get("purchaseRate"),
      saleRate: get("saleRate"),
      discountType: discount && Number(discount) !== 0 ? "AMOUNT_PER_UNIT" : "NONE",
      discountValue: discount && Number(discount) !== 0 ? discount : "0",
      minStockLevel: get("minStockDozens"),
      effectiveFrom: lookups.today,
    });
    if (!parsed.success) errors.push(...issueMessages(parsed.error, PRODUCT_LABELS));

    const code = get("code").trim().toUpperCase();
    if (code && seenCodes.has(code))
      errors.push(`Code: ${code} appears more than once in the file`);
    seenCodes.add(code);

    const line = i + 2;
    if (errors.length > 0 || !parsed.success) return { line, values, status: "error", errors };
    const existingId = lookups.existingCodes.get(parsed.data.code);
    return {
      line,
      values,
      status: existingId ? "update" : "new",
      errors,
      input: parsed.data,
      existingId,
    };
  });
}

// ───────────────────────── Customers ─────────────────────────

export const CUSTOMER_COLUMNS: Column[] = [
  { key: "name", label: "Name", required: true, aliases: ["customer", "customer name", "owner"] },
  { key: "shopName", label: "Shop name", aliases: ["shop"] },
  { key: "type", label: "Type", aliases: ["customer type"] },
  { key: "phone", label: "Phone", aliases: ["mobile", "phone number"] },
  { key: "whatsapp", label: "WhatsApp", aliases: ["whatsapp number"] },
  { key: "address", label: "Address" },
  { key: "area", label: "Area", aliases: ["route", "area route"] },
  { key: "routeSequence", label: "Visiting order", aliases: ["sequence", "route order"] },
  { key: "creditLimit", label: "Credit limit" },
];

const CUSTOMER_LABELS: Record<string, string> = {
  name: "Name",
  shopName: "Shop name",
  type: "Type",
  phone: "Phone",
  whatsapp: "WhatsApp",
  address: "Address",
  areaId: "Area",
  routeSequence: "Visiting order",
  creditLimit: "Credit limit",
  openingBalances: "Opening balance",
};

/** "Opening: Crunchy Bites Foods" → "Crunchy Bites Foods". */
export function openingColumnCompany(header: string): string | null {
  const match = /^opening(?: balance)?\s*[:\-–]\s*(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

export const openingColumnLabel = (companyName: string) => `Opening: ${companyName}`;

const TYPE_ALIASES: Record<string, (typeof CUSTOMER_TYPES)[number]> = {
  retailer: "RETAILER",
  retail: "RETAILER",
  wholesaler: "WHOLESALER",
  wholesale: "WHOLESALER",
  dealer: "DEALER",
  "bike supplier": "BIKE_SUPPLIER",
  bike: "BIKE_SUPPLIER",
};

export type CustomerLookups = {
  /** Lower-cased area name → id (active areas). */
  areas: Map<string, string>;
  /** Lower-cased company name → id (active companies). */
  companies: Map<string, string>;
  /** `name|phone` keys of existing customers, for duplicate detection. */
  existingKeys: Set<string>;
};

/** Name and phone, compared however the phone was typed ("0300-…" and "+92 300…" match). */
export const customerKey = (name: string, phone: string | null | undefined) =>
  `${nameKey(name)}|${(normalizePkPhone(phone ?? "") ?? phone ?? "").replace(/\D/g, "")}`;

export function validateCustomerRows(
  table: Table,
  lookups: CustomerLookups,
): ValidatedRow<CustomerInput>[] {
  const index = columnIndex(table.headers, CUSTOMER_COLUMNS);
  const openingColumns = table.headers
    .map((header, i) => ({ header, i, company: openingColumnCompany(header) }))
    .filter((c): c is { header: string; i: number; company: string } => c.company !== null);
  const seen = new Set<string>();

  return table.rows.map((row, r) => {
    const get = (key: string) => (index[key] === undefined ? "" : (row[index[key]!] ?? ""));
    const values = Object.fromEntries([
      ...CUSTOMER_COLUMNS.map((c) => [c.label, get(c.key)]),
      ...openingColumns.map((c) => [c.header, row[c.i] ?? ""]),
    ]);
    const errors: string[] = [];

    const typeText = nameKey(get("type").replace(/_/g, " "));
    const type = typeText === "" ? "RETAILER" : TYPE_ALIASES[typeText];
    if (!type) errors.push(`Type: use Retailer, Wholesaler, Dealer or Bike supplier`);

    const areaName = get("area");
    const areaId = areaName ? lookups.areas.get(nameKey(areaName)) : undefined;
    if (areaName && !areaId) errors.push(`Area: "${areaName}" is not an active area`);

    const openingBalances: Record<string, string> = {};
    for (const col of openingColumns) {
      const companyId = lookups.companies.get(nameKey(col.company));
      const amount = (row[col.i] ?? "").trim();
      if (!companyId) {
        if (amount) errors.push(`${col.header}: "${col.company}" is not an active company`);
        continue;
      }
      if (amount) openingBalances[companyId] = amount;
    }

    const parsed = customerSchema.safeParse({
      name: get("name"),
      shopName: get("shopName"),
      type: type ?? "RETAILER",
      phone: get("phone"),
      whatsapp: get("whatsapp"),
      address: get("address"),
      areaId: areaId ?? "",
      routeSequence: get("routeSequence"),
      creditLimit: get("creditLimit"),
      openingBalances,
    });
    if (!parsed.success) errors.push(...issueMessages(parsed.error, CUSTOMER_LABELS));

    if (parsed.success) {
      const key = customerKey(parsed.data.name, parsed.data.phone);
      if (lookups.existingKeys.has(key))
        errors.push("A customer with this name and phone already exists");
      else if (seen.has(key)) errors.push("This customer appears more than once in the file");
      seen.add(key);
    }

    const line = r + 2;
    if (errors.length > 0 || !parsed.success) return { line, values, status: "error", errors };
    return { line, values, status: "new", errors, input: parsed.data };
  });
}

/** Template header row for each import. */
export function templateHeaders(kind: ImportKind, companyNames: string[] = []): string[] {
  return kind === "products"
    ? PRODUCT_COLUMNS.map((c) => c.label)
    : [...CUSTOMER_COLUMNS.map((c) => c.label), ...companyNames.map(openingColumnLabel)];
}

export const IMPORT_NOTES: Record<ImportKind, string[]> = {
  products: [
    "One row per product. Rates are per dozen in PKR.",
    "A code that already exists updates that product; new rates take effect today and are kept in price history.",
    "Discount per dozen is optional. Quantity slabs can be added on the product page after importing.",
    "Minimum stock is in dozens, e.g. 12, 12.5 or 12dz 4pk.",
  ],
  customers: [
    "One row per customer. Type is Retailer, Wholesaler, Dealer or Bike supplier (blank = Retailer).",
    "Area must match an existing area name. Leave Credit limit blank for no limit.",
    "Opening balance columns are per company: what the customer owes for that company (negative = advance).",
    "In Excel, format the Phone and WhatsApp columns as Text so leading zeros are kept.",
  ],
};
