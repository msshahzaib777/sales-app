import writeXlsxFile from "write-excel-file/node";
import { describe, expect, it } from "vitest";

import { ServiceError } from "../errors";
import {
  customerKey,
  type CustomerLookups,
  EXAMPLE_MARK,
  IMPORT_KINDS,
  readTable,
  templateExamples,
  templateHeaders,
  validateAreaRows,
  validateCompanyRows,
  validateCustomerRows,
  validateProductRows,
} from "./import-rows";

const csv = (text: string) => Buffer.from(text, "utf8");

describe("readTable", () => {
  it("reads CSV with a BOM, quotes and blank lines", async () => {
    const table = await readTable(
      "products.csv",
      csv('﻿Code,Name,Company\r\nCB01,"Chips, Masala",Crunchy\r\n\r\nCB02,Salted,Crunchy\r\n'),
    );
    expect(table.headers).toEqual(["Code", "Name", "Company"]);
    expect(table.rows).toEqual([
      ["CB01", "Chips, Masala", "Crunchy"],
      ["CB02", "Salted", "Crunchy"],
    ]);
  });

  it("reads the first sheet of an .xlsx file and restores leading zeros on phone numbers", async () => {
    const buffer = await writeXlsxFile([
      [{ value: "Name" }, { value: "Phone" }, { value: "Credit limit" }],
      [{ value: "Ali" }, { value: 3001234567 }, { value: 25000.5 }],
    ]).toBuffer();
    const table = await readTable("customers.xlsx", buffer);
    expect(table.rows).toEqual([["Ali", "03001234567", "25000.5"]]);
  });

  it("leaves out the sample sheet's EXAMPLE rows, and says so when nothing else is left", async () => {
    const table = await readTable(
      "areas.csv",
      csv("Name,Warehouse\nEXAMPLE Shahdara,Main\nTownship,Main\nexample  Gulberg,Main\n"),
    );
    expect(table.rows).toEqual([["Township", "Main"]]);
    await expect(
      readTable("areas.csv", csv("Name,Warehouse\nEXAMPLE Shahdara,Main\n")),
    ).rejects.toThrow("only the example rows");
  });

  it("rejects other formats, empty files and header-only files", async () => {
    await expect(readTable("list.xls", csv("a"))).rejects.toThrow(ServiceError);
    await expect(readTable("list.csv", csv(""))).rejects.toThrow("empty");
    await expect(readTable("list.csv", csv("Code,Name\n"))).rejects.toThrow("no data rows");
    await expect(readTable("broken.xlsx", csv("not a zip"))).rejects.toThrow("could not be read");
  });
});

const productLookups = {
  companies: new Map([["crunchy bites foods", "c1"]]),
  existingCodes: new Map([["CB01", "p1"]]),
  today: "2026-10-24",
};

describe("validateCompanyRows", () => {
  const lookups = {
    warehouses: new Map([["main", "w1"]]),
    existingNames: new Set(["crunchy bites foods"]),
  };
  it("checks warehouse, phones (+92), terms and names already used", () => {
    const rows = validateCompanyRows(
      {
        headers: templateHeaders("companies"),
        rows: [
          [
            "Golden Crisp",
            "Main",
            "Imran",
            "0300-1112233",
            "",
            "Bilal",
            "0301 4455667",
            "",
            "150",
            "185000",
          ],
          ["Crunchy Bites Foods", "Main", "", "", "", "", "", "15", "", ""],
          ["Nowhere Foods", "Far", "", "call me", "", "", "", "400", "", ""],
          ["golden crisp", "Main", "", "", "", "", "", "", "", ""],
        ],
      },
      lookups,
    );
    expect(rows.map((r) => r.status)).toEqual(["new", "error", "error", "error"]);
    expect(rows[0]!.input).toMatchObject({
      warehouseId: "w1",
      phone: "+92 3001112233",
      orderBookerPhone: "+92 3014455667",
      paymentTermsDays: 0,
      sackRate: "150",
      openingBalance: "185000",
    });
    expect(rows[1]!.errors).toEqual([
      "A company with this name already exists (edit it on its page)",
    ]);
    expect(rows[2]!.errors).toEqual(
      expect.arrayContaining([
        'Warehouse: "Far" is not an active warehouse',
        "Phone: Enter a Pakistani number, e.g. 0300 1234567",
        "Payment terms (days): The payment terms must be at most 365",
      ]),
    );
    expect(rows[3]!.errors).toEqual(["This company appears more than once in the file"]);
  });
});

describe("validateAreaRows", () => {
  it("needs a known warehouse and a name not used in that warehouse", () => {
    const rows = validateAreaRows(
      {
        headers: ["Name", "Warehouse", "Visiting order"],
        rows: [
          ["Township", "Main", "2"],
          ["Shahdara Town", "main", ""],
          ["Gulberg", "Far", ""],
          ["township", "Main", ""],
        ],
      },
      { warehouses: new Map([["main", "w1"]]), existingKeys: new Set(["w1|shahdara town"]) },
    );
    expect(rows.map((r) => r.status)).toEqual(["new", "error", "error", "error"]);
    expect(rows[0]!.input).toMatchObject({ warehouseId: "w1", name: "Township", sortOrder: 2 });
    expect(rows[1]!.errors).toEqual(["This warehouse already has an area with this name"]);
    expect(rows[2]!.errors).toEqual(['Warehouse: "Far" is not an active warehouse']);
    expect(rows[3]!.errors).toEqual(["This area appears more than once in the file"]);
  });
});

describe("sample sheet", () => {
  it("has example rows for every import that match its columns and are never imported", async () => {
    for (const kind of IMPORT_KINDS) {
      const headers = templateHeaders(kind, ["Crunchy Bites Foods"]);
      const examples = templateExamples(kind, { companies: ["Crunchy Bites Foods"] });
      expect(examples.length).toBeGreaterThan(0);
      for (const row of examples) {
        expect(row).toHaveLength(headers.length);
        expect(row[0]!.startsWith(EXAMPLE_MARK)).toBe(true);
      }
    }
  });
});

describe("validateProductRows", () => {
  const headers = [
    "Code",
    "Name",
    "Company",
    "Purchase rate",
    "Sale rate",
    "Discount per dozen",
    "Minimum stock (dozens)",
  ];

  it("marks new, updated and invalid rows with readable errors", () => {
    const rows = validateProductRows(
      {
        headers,
        rows: [
          ["cb01", "Masala Chips", "Crunchy Bites Foods", "1,200", "1320", "200", "10"],
          ["CB09", "New Chips", "crunchy  bites foods", "100", "110", "", ""],
          ["CB10", "Bad", "Unknown Co", "abc", "110", "", "1.04"],
          ["CB09", "Again", "Crunchy Bites Foods", "100", "110", "", ""],
        ],
      },
      productLookups,
    );
    expect(rows.map((r) => [r.line, r.status])).toEqual([
      [2, "update"],
      [3, "new"],
      [4, "error"],
      [5, "error"],
    ]);
    expect(rows[0]).toMatchObject({
      existingId: "p1",
      input: { code: "CB01", discountType: "AMOUNT_PER_UNIT", minStockLevel: 120 },
    });
    expect(rows[1]!.input).toMatchObject({
      discountType: "NONE",
      discountValue: "0",
      minStockLevel: 0,
    });
    expect(rows[2]!.errors).toEqual([
      'Company: "Unknown Co" is not an active company',
      "Purchase rate: Enter the purchase rate in rupees, with at most 2 decimals",
      "Minimum stock (dozens): Enter the minimum stock in dozens, like 12, 12.5, 12dz 4pk or 4pk",
    ]);
    expect(rows[3]!.errors).toEqual(["Code: CB09 appears more than once in the file"]);
  });

  it("accepts header spelling variations and reports missing columns", () => {
    const ok = validateProductRows(
      {
        headers: ["code", "PRODUCT NAME", "supplier", "cost", "rate"],
        rows: [["X1", "Y", "Crunchy Bites Foods", "1", "2"]],
      },
      productLookups,
    );
    expect(ok[0]!.status).toBe("new");
    expect(() =>
      validateProductRows({ headers: ["Code", "Name"], rows: [["a", "b"]] }, productLookups),
    ).toThrow("Missing columns: Company, Purchase rate, Sale rate");
  });
});

describe("validateCustomerRows", () => {
  const lookups: CustomerLookups = {
    areas: [
      { id: "a1", name: "Shahdara Town", warehouseId: "w1", isActive: true },
      { id: "a2", name: "Township", warehouseId: "w1", isActive: true },
      { id: "a3", name: "Township", warehouseId: "w2", isActive: true },
      { id: "a4", name: "Old Route", warehouseId: "w1", isActive: false },
    ],
    warehouses: [
      { id: "w1", name: "Main" },
      { id: "w2", name: "City Store" },
    ],
    companies: new Map([
      ["crunchy bites foods", "c1"],
      ["golden crisp", "c2"],
    ]),
    existingKeys: new Set([customerKey("Existing Shop", "0300-1111111")]),
  };
  const headers = [...templateHeaders("customers", ["Crunchy Bites Foods", "Golden Crisp"])];
  /** A row with only name, phone, area and warehouse filled in. */
  const row = (name: string, phone: string, area = "", warehouse = "") => {
    const cells = headers.map(() => "");
    cells[headers.indexOf("Name")] = name;
    cells[headers.indexOf("Phone")] = phone;
    cells[headers.indexOf("Area")] = area;
    cells[headers.indexOf("Warehouse")] = warehouse;
    return cells;
  };

  it("reads types, areas and per-company opening balances", () => {
    const [read] = validateCustomerRows(
      {
        headers,
        rows: [
          [
            "Ali Khan",
            "Khan Store",
            "bike supplier",
            "0300-1234567",
            "",
            "Shop 4",
            "shahdara  town",
            "",
            "3",
            "",
            "5,000",
            "-250",
          ],
        ],
      },
      lookups,
    );
    expect(read!.status).toBe("new");
    expect(read!.newArea).toBeUndefined();
    expect(read!.input).toMatchObject({
      type: "BIKE_SUPPLIER",
      areaId: "a1",
      routeSequence: 3,
      creditLimit: null,
      openingBalances: { c1: "5000", c2: "-250" },
    });
  });

  it("matches an area by warehouse, and by name alone when the warehouse is unknown here", () => {
    const rows = validateCustomerRows(
      {
        headers,
        rows: [
          row("A", "0300-0000001", "Township", "city store"),
          row("B", "0300-0000002", "Shahdara Town", "Lahore Godown"),
          row("C", "0300-0000003", "Township"),
          row("D", "0300-0000004", "Township", "Lahore Godown"),
          row("E", "0300-0000005", "Old Route"),
        ],
      },
      lookups,
    );
    expect(rows.map((r) => r.input?.areaId ?? r.errors[0])).toEqual([
      "a3",
      "a1",
      'Area: "Township" is in more than one warehouse; fill in the Warehouse column',
      'Area: "Township" is in more than one warehouse; fill in the Warehouse column',
      'Area: "Old Route" is turned off; turn it on under Areas first',
    ]);
  });

  it("makes an area this business does not have, in the named or only warehouse", () => {
    const rows = validateCustomerRows(
      {
        headers,
        rows: [
          row("A", "0300-0000001", " Model  Town ", "City Store"),
          row("B", "0300-0000002", "Model Town"),
          row("C", "0300-0000003", "Model Town", "Lahore Godown"),
        ],
      },
      lookups,
    );
    expect(rows[0]).toMatchObject({
      status: "new",
      newArea: { warehouseId: "w2", warehouseName: "City Store", name: "Model Town" },
      note: "New area: Model Town (City Store)",
    });
    expect(rows[0]!.input!.areaId).toBeNull();
    expect(rows[1]!.errors).toEqual([
      'Area: "Model Town" is new; fill in the Warehouse column so it can be created',
    ]);
    expect(rows[2]!.errors).toEqual([
      'Warehouse: "Lahore Godown" is not an active warehouse, so the new area "Model Town" has no home',
    ]);

    // With one warehouse, a new area needs no Warehouse column.
    // Rows naming the same new area (any spelling) share one, spelt as the first row has it.
    const [only, same] = validateCustomerRows(
      {
        headers,
        rows: [row("B", "0300-0000002", "Model Town"), row("F", "0300-0000006", "model  town")],
      },
      { ...lookups, warehouses: [{ id: "w1", name: "Main" }] },
    );
    expect(only!.newArea).toEqual({ warehouseId: "w1", warehouseName: "Main", name: "Model Town" });
    expect(same).toMatchObject({ newArea: only!.newArea, note: "New area: Model Town (Main)" });
  });

  it("skips customers already there, and reports unknown companies, types and duplicates", () => {
    const rows = validateCustomerRows(
      {
        headers: [...headers, "Opening: Ghost Foods"],
        rows: [
          ["Bad", "", "supermarket", "", "", "", "", "", "", "", "", "", "100"],
          [...row("existing shop", "03001111111", "Nowhere"), ""],
          [...row("Twin", "0311-2222222"), ""],
          [...row("Twin", "0311 2222222"), ""],
        ],
      },
      lookups,
    );
    expect(rows.map((r) => r.status)).toEqual(["error", "skip", "new", "error"]);
    expect(rows[0]!.errors).toEqual([
      "Type: use Retailer, Wholesaler, Dealer or Bike supplier",
      'Opening: Ghost Foods: "Ghost Foods" is not an active company',
    ]);
    expect(rows[1]).toMatchObject({ errors: [], note: "Already there" });
    expect(rows[3]!.errors).toEqual(["This customer appears more than once in the file"]);
  });
});
