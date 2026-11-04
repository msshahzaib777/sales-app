import { normalizePkPhone } from "@/lib/phone";
import Papa from "papaparse";
import { readSheet } from "read-excel-file/node";
import type { ZodError } from "zod";

import {
  type AreaInput,
  areaSchema,
  type CompanyInput,
  companySchema,
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

/** In the order they depend on each other: products need companies, customers need areas. */
export const IMPORT_KINDS = ["companies", "products", "areas", "customers"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** Rows of the sample sheet that start with this are examples, never imported. */
export const EXAMPLE_MARK = "EXAMPLE";

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
  // The sample sheet's example rows (first cell "EXAMPLE …") are left out, even if not deleted.
  const rows = nonEmpty
    .slice(1)
    .map((row) => headers.map((h, i) => cellText(row[i], h)))
    .filter((row) => !(row[0] ?? "").toUpperCase().startsWith(EXAMPLE_MARK));
  if (rows.length === 0)
    throw new ServiceError(
      "The file has only the example rows. Add your own rows under the header.",
    );
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
  { key: "shortName", label: "Short name", aliases: ["short", "bill name"] },
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
  shortName: "Short name",
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
      shortName: get("shortName"),
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

// ───────────────────────── Companies ─────────────────────────

export const COMPANY_COLUMNS: Column[] = [
  { key: "name", label: "Name", required: true, aliases: ["company", "company name"] },
  { key: "warehouse", label: "Warehouse", required: true },
  { key: "contactName", label: "Contact person", aliases: ["contact"] },
  { key: "phone", label: "Phone", aliases: ["mobile", "phone number"] },
  { key: "address", label: "Address" },
  { key: "orderBookerName", label: "Order booker", aliases: ["booker", "booker name"] },
  { key: "orderBookerPhone", label: "Booker phone", aliases: ["order booker phone"] },
  {
    key: "paymentTermsDays",
    label: "Payment terms (days)",
    aliases: ["payment terms", "terms", "credit days"],
  },
  { key: "sackRate", label: "Sack price", aliases: ["sack rate"] },
  {
    key: "openingBalance",
    label: "Opening balance",
    aliases: ["we owe", "opening", "balance"],
  },
];

const COMPANY_LABELS: Record<string, string> = {
  name: "Name",
  warehouseId: "Warehouse",
  contactName: "Contact person",
  phone: "Phone",
  address: "Address",
  orderBookerName: "Order booker",
  orderBookerPhone: "Booker phone",
  paymentTermsDays: "Payment terms (days)",
  sackRate: "Sack price",
  openingBalance: "Opening balance",
};

export type CompanyLookups = {
  /** Lower-cased warehouse name → id (active warehouses). */
  warehouses: Map<string, string>;
  /** Lower-cased names of existing companies. */
  existingNames: Set<string>;
};

export function validateCompanyRows(
  table: Table,
  lookups: CompanyLookups,
): ValidatedRow<CompanyInput>[] {
  const index = columnIndex(table.headers, COMPANY_COLUMNS);
  const seen = new Set<string>();
  return table.rows.map((row, i) => {
    const get = (key: string) => (index[key] === undefined ? "" : (row[index[key]!] ?? ""));
    const values = Object.fromEntries(COMPANY_COLUMNS.map((c) => [c.label, get(c.key)]));
    const errors: string[] = [];

    const warehouseId = lookups.warehouses.get(nameKey(get("warehouse")));
    if (get("warehouse") && !warehouseId)
      errors.push(`Warehouse: "${get("warehouse")}" is not an active warehouse`);

    const parsed = companySchema.safeParse({
      warehouseId: warehouseId ?? "unknown",
      name: get("name"),
      contactName: get("contactName"),
      phone: get("phone"),
      address: get("address"),
      orderBookerName: get("orderBookerName"),
      orderBookerPhone: get("orderBookerPhone"),
      paymentTermsDays: get("paymentTermsDays") || "0",
      sackRate: get("sackRate"),
      openingBalance: get("openingBalance"),
    });
    if (!parsed.success) errors.push(...issueMessages(parsed.error, COMPANY_LABELS));

    const key = nameKey(get("name"));
    if (key && lookups.existingNames.has(key))
      errors.push("A company with this name already exists (edit it on its page)");
    else if (key && seen.has(key)) errors.push("This company appears more than once in the file");
    seen.add(key);

    const line = i + 2;
    if (errors.length > 0 || !parsed.success) return { line, values, status: "error", errors };
    return { line, values, status: "new", errors, input: parsed.data };
  });
}

// ───────────────────────── Areas ─────────────────────────

export const AREA_COLUMNS: Column[] = [
  { key: "name", label: "Name", required: true, aliases: ["area", "area name", "route"] },
  { key: "warehouse", label: "Warehouse", required: true },
  { key: "sortOrder", label: "Visiting order", aliases: ["order", "sort order", "sequence"] },
];

export type AreaLookups = {
  warehouses: Map<string, string>;
  /** `warehouseId|lower-cased name` of existing areas. */
  existingKeys: Set<string>;
};

export function validateAreaRows(table: Table, lookups: AreaLookups): ValidatedRow<AreaInput>[] {
  const index = columnIndex(table.headers, AREA_COLUMNS);
  const seen = new Set<string>();
  return table.rows.map((row, i) => {
    const get = (key: string) => (index[key] === undefined ? "" : (row[index[key]!] ?? ""));
    const values = Object.fromEntries(AREA_COLUMNS.map((c) => [c.label, get(c.key)]));
    const errors: string[] = [];

    const warehouseId = lookups.warehouses.get(nameKey(get("warehouse")));
    if (get("warehouse") && !warehouseId)
      errors.push(`Warehouse: "${get("warehouse")}" is not an active warehouse`);

    const parsed = areaSchema.safeParse({
      warehouseId: warehouseId ?? "unknown",
      name: get("name"),
      sortOrder: get("sortOrder"),
    });
    if (!parsed.success)
      errors.push(
        ...issueMessages(parsed.error, {
          name: "Name",
          warehouseId: "Warehouse",
          sortOrder: "Visiting order",
        }),
      );

    const key = `${warehouseId}|${nameKey(get("name"))}`;
    if (warehouseId && lookups.existingKeys.has(key))
      errors.push("This warehouse already has an area with this name");
    else if (warehouseId && seen.has(key))
      errors.push("This area appears more than once in the file");
    seen.add(key);

    const line = i + 2;
    if (errors.length > 0 || !parsed.success) return { line, values, status: "error", errors };
    return { line, values, status: "new", errors, input: parsed.data };
  });
}

/** Template header row for each import. */
export function templateHeaders(kind: ImportKind, companyNames: string[] = []): string[] {
  if (kind === "products") return PRODUCT_COLUMNS.map((c) => c.label);
  if (kind === "companies") return COMPANY_COLUMNS.map((c) => c.label);
  if (kind === "areas") return AREA_COLUMNS.map((c) => c.label);
  return [...CUSTOMER_COLUMNS.map((c) => c.label), ...companyNames.map(openingColumnLabel)];
}

/**
 * Example rows for the sample sheet, using this business's own warehouse, company and area names
 * so they show real choices. Each starts with EXAMPLE, so it is never imported.
 */
export function templateExamples(
  kind: ImportKind,
  names: { warehouse?: string; company?: string; area?: string; companies?: string[] },
): string[][] {
  const warehouse = names.warehouse ?? "Main Warehouse";
  const company = names.company ?? "Crunchy Bites Foods";
  const area = names.area ?? "Shahdara Town";
  if (kind === "companies")
    return [
      [
        `${EXAMPLE_MARK} Crunchy Bites Foods`,
        warehouse,
        "Imran Sheikh",
        "0300-1112233",
        "Sundar Industrial Estate, Lahore",
        "Bilal Ahmed",
        "0301-4455667",
        "15",
        "150",
        "185000",
      ],
      [
        `${EXAMPLE_MARK} Golden Crisp Snacks`,
        warehouse,
        "",
        "042-35123456",
        "",
        "",
        "",
        "30",
        "",
        "",
      ],
    ];
  if (kind === "products")
    return [
      [`${EXAMPLE_MARK} CB01`, "Masala Chips Rs10", "Masala 10", company, "95", "110", "4", "12"],
      [`${EXAMPLE_MARK} CB02`, "Salted Chips Rs10", "", company, "95", "110", "", ""],
    ];
  if (kind === "areas")
    return [
      [`${EXAMPLE_MARK} Shahdara Town`, warehouse, "1"],
      [`${EXAMPLE_MARK} Township`, warehouse, "2"],
    ];
  const openings = (names.companies ?? []).map((_, i) => (i === 0 ? "3500" : ""));
  return [
    [
      `${EXAMPLE_MARK} Ali Khan`,
      "Khan Kiryana Store",
      "Retailer",
      "0300-1234567",
      "0300-1234567",
      "Shop 12, Main Bazaar",
      area,
      "1",
      "25000",
      ...openings,
    ],
    [
      `${EXAMPLE_MARK} Asif Malik`,
      "Malik Traders",
      "Wholesaler",
      "0321-7654321",
      "",
      "",
      area,
      "2",
      "",
      ...openings.map(() => ""),
    ],
  ];
}

export const IMPORT_NOTES: Record<ImportKind, string[]> = {
  companies: [
    "One row per company. Warehouse must match an existing warehouse name (Settings → Warehouses).",
    "Payment terms: days until a company bill is due (blank = 0). Sack price: credit per empty sack sent back (blank = none).",
    "Opening balance: what you owe the company now (minus if it owes you).",
    "A company name that already exists is skipped; edit it on its page.",
  ],
  areas: [
    "One row per area / route. Warehouse must match an existing warehouse name.",
    "Visiting order is optional: 1 is visited first.",
  ],
  products: [
    "One row per product. Rates are per dozen in PKR.",
    "A code that already exists updates that product; new rates take effect today and are kept in price history.",
    "Discount per dozen is optional. Quantity slabs can be added on the product page after importing.",
    "Short name is optional (up to 24 letters): bills print it instead of the full name.",
    "Minimum stock is in dozens, e.g. 12, 12.5 or 12dz 4pk.",
  ],
  customers: [
    "One row per customer. Type is Retailer, Wholesaler, Dealer or Bike supplier (blank = Retailer).",
    "Area must match an existing area name. Leave Credit limit blank for no limit.",
    "Opening balance columns are per company: what the customer owes for that company (negative = advance).",
    "In Excel, format the Phone and WhatsApp columns as Text so leading zeros are kept.",
  ],
};
