import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";
import writeXlsxFile from "write-excel-file/node";

import { listParamsSchema } from "@/lib/list-params";

import { ForbiddenError } from "../../auth/permissions";
import { prisma } from "../../db/client";
import { createTenantDb } from "../../db/tenant";
import { createArea } from "./areas";
import type { ServiceCtx } from "./common";
import { createCompany } from "./companies";
import { exportCustomers, getCustomer } from "./customers";
import { commitImport, previewImport } from "./import";
import { customerExportTable } from "./import-rows";
import { createWarehouse } from "./warehouses";

const file = (name: string, text: string) => ({ name, bytes: Buffer.from(text, "utf8") });

let ctx: ServiceCtx;
let crunchyId: string;

beforeEach(async () => {
  const suffix = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({ data: { name: `I ${suffix}`, slug: `i-${suffix}` } });
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `i-${suffix}@t.local`,
      name: "Owner",
      role: "OWNER",
      passwordHash: "x",
    },
  });
  ctx = {
    db: createTenantDb(tenant.id),
    user: { id: owner.id, role: "OWNER", tenantId: tenant.id },
  };
  const warehouse = await createWarehouse(ctx, { name: "Main" });
  crunchyId = (
    await createCompany(ctx, {
      warehouseId: warehouse.id,
      name: "Crunchy Bites Foods",
      paymentTermsDays: "15",
    })
  ).id;
  await createArea(ctx, { warehouseId: warehouse.id, name: "Shahdara Town" });
});

const PRODUCTS = [
  "Code,Name,Company,Purchase rate,Sale rate,Discount per dozen,Minimum stock (dozens)",
  "CB01,Masala Chips,Crunchy Bites Foods,1200,1320,200,10",
  "CB02,Salted Chips,Crunchy Bites Foods,1200,1320,,",
  "CB03,Bad Row,Nobody,1200,abc,,",
].join("\n");

describe("product import", () => {
  it("previews without saving, then imports valid rows and skips errors", async () => {
    const preview = await previewImport(ctx, "products", file("p.csv", PRODUCTS));
    expect(preview).toMatchObject({ totalRows: 3, newCount: 2, updateCount: 0, errorCount: 1 });
    expect(await ctx.db.product.count()).toBe(0);

    const result = await commitImport(ctx, "products", file("p.csv", PRODUCTS), randomUUID());
    expect(result).toMatchObject({ created: 2, updated: 0, skipped: 1 });
    const cb01 = await ctx.db.product.findUniqueOrThrow({
      where: { tenantId_code: { tenantId: ctx.user.tenantId, code: "CB01" } },
      include: { priceHistory: true },
    });
    expect(cb01).toMatchObject({ discountType: "AMOUNT_PER_UNIT", minStockLevel: 120 });
    expect(cb01.priceHistory).toHaveLength(1);
  });

  it("updates existing codes and records new rates in price history", async () => {
    await commitImport(ctx, "products", file("p.csv", PRODUCTS), randomUUID());
    const changed = PRODUCTS.replace(
      "CB01,Masala Chips,Crunchy Bites Foods,1200,1320",
      "CB01,Masala Chips,Crunchy Bites Foods,1250,1380",
    );
    const preview = await previewImport(ctx, "products", file("p.csv", changed));
    expect(preview).toMatchObject({ newCount: 0, updateCount: 2, errorCount: 1 });
    const result = await commitImport(ctx, "products", file("p.csv", changed), randomUUID());
    expect(result).toMatchObject({ created: 0, updated: 1, skipped: 1 });
    const history = await ctx.db.productPriceHistory.findMany({
      where: { product: { code: "CB01" } },
    });
    expect(history.map((h) => h.saleRate.toFixed(2)).sort()).toEqual(["1320.00", "1380.00"]);
  });

  it("is owner-only", async () => {
    const staff = { ...ctx, user: { ...ctx.user, role: "STAFF" as const } };
    await expect(previewImport(staff, "products", file("p.csv", PRODUCTS))).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("company and area import", () => {
  it("imports companies with their opening balance, then areas, then customers in them", async () => {
    const companies = [
      "Name,Warehouse,Contact person,Phone,Address,Order booker,Booker phone,Payment terms (days),Sack price,Opening balance",
      "EXAMPLE Sample Foods,Main,,,,,,15,,",
      "Golden Crisp Snacks,Main,Imran,0300-1112233,,Bilal,0301-4455667,30,150,185000",
      "Crunchy Bites Foods,Main,,,,,,15,,",
    ].join("\n");
    const preview = await previewImport(ctx, "companies", file("c.csv", companies));
    expect(preview).toMatchObject({ totalRows: 2, newCount: 1, errorCount: 1 });
    const result = await commitImport(ctx, "companies", file("c.csv", companies), randomUUID());
    expect(result).toMatchObject({ created: 1, updated: 0, skipped: 1 });
    const golden = await ctx.db.company.findFirstOrThrow({
      where: { name: "Golden Crisp Snacks" },
    });
    expect(golden).toMatchObject({ paymentTermsDays: 30, orderBookerPhone: "+92 3014455667" });
    expect(golden.sackRate?.toFixed(2)).toBe("150.00");
    // What we owe is in the company ledger, with its opening-balance bill.
    const owed = await ctx.db.ledgerEntry.aggregate({
      where: { companyId: golden.id, partyType: "COMPANY" },
      _sum: { credit: true },
    });
    expect(owed._sum.credit?.toFixed(2)).toBe("185000.00");
    expect(await ctx.db.companyBill.count({ where: { companyId: golden.id } })).toBe(1);

    const areas = ["Name,Warehouse,Visiting order", "Township,Main,2", "Shahdara Town,Main,1"].join(
      "\n",
    );
    expect(await commitImport(ctx, "areas", file("a.csv", areas), randomUUID())).toMatchObject({
      created: 1,
      updated: 0,
      skipped: 1,
    });
    const customers = [
      "Name,Area,Phone,Opening: Golden Crisp Snacks",
      "Kashif,Township,03211234567,1200",
    ].join("\n");
    await commitImport(ctx, "customers", file("k.csv", customers), randomUUID());
    const kashif = await ctx.db.customer.findFirstOrThrow({
      where: { name: "Kashif" },
      include: { area: true },
    });
    expect([kashif.area?.name, kashif.phone]).toEqual(["Township", "+92 3211234567"]);
    expect((await getCustomer(ctx, kashif.id)).openingBalances).toEqual({ [golden.id]: "1200.00" });
  });

  it("is for owners only", async () => {
    const staff: ServiceCtx = { ...ctx, user: { ...ctx.user, role: "STAFF" } };
    await expect(
      previewImport(staff, "areas", file("a.csv", "Name,Warehouse\nX,Main")),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("customer import", () => {
  const CUSTOMERS = [
    "Name,Shop name,Type,Phone,Area,Credit limit,Opening: Crunchy Bites Foods",
    "Ali Khan,Khan Store,Retailer,0300-1234567,Shahdara Town,25000,5000",
    "Zubair,,Wholesaler,0301-7654321,,,",
    "Nobody,,Retailer,,Atlantis,,",
    "Bad,,Supermarket,,,,",
  ].join("\n");

  it("imports customers with opening balances, makes new areas, and skips them the second time", async () => {
    const preview = await previewImport(ctx, "customers", file("c.csv", CUSTOMERS));
    expect(preview).toMatchObject({ newCount: 3, skipCount: 0, errorCount: 1 });
    expect(preview.newAreas).toEqual(["Atlantis (Main)"]);
    expect(await ctx.db.area.count()).toBe(1);

    const result = await commitImport(ctx, "customers", file("c.csv", CUSTOMERS), randomUUID());
    expect(result).toEqual({ created: 3, updated: 0, existing: 0, skipped: 1, areasCreated: 1 });
    const ali = await ctx.db.customer.findFirstOrThrow({ where: { name: "Ali Khan" } });
    expect((await getCustomer(ctx, ali.id)).openingBalances).toEqual({ [crunchyId]: "5000.00" });
    expect(ali.creditLimit?.toFixed(2)).toBe("25000.00");
    const nobody = await ctx.db.customer.findFirstOrThrow({
      where: { name: "Nobody" },
      include: { area: true },
    });
    expect(nobody.area?.name).toBe("Atlantis");

    // Importing the same file again leaves the customers (and areas) as they are.
    const again = await previewImport(ctx, "customers", file("c.csv", CUSTOMERS));
    expect(again).toMatchObject({ newCount: 0, skipCount: 3, errorCount: 1, newAreas: [] });
    await expect(
      commitImport(ctx, "customers", file("c.csv", CUSTOMERS), randomUUID()),
    ).rejects.toThrow("nothing new");
    expect(await ctx.db.customer.count()).toBe(3);
    expect(await ctx.db.area.count()).toBe(2);
  });

  it("moves customers to another Taqseem: export there, import here, areas matched or made", async () => {
    const setup = [
      "Name,Shop name,Type,Phone,WhatsApp,Address,Area,Visiting order,Credit limit",
      "Ali Khan,Khan Store,Bike supplier,0300-1234567,0300-1234567,Shop 4,Shahdara Town,2,25000",
      "Bilal,,Dealer,0301-1111111,,,Model Town,1,",
      "Chand,,Retailer,,,,,,",
    ].join("\n");
    await commitImport(ctx, "customers", file("c.csv", setup), randomUUID());
    const table = customerExportTable(await exportCustomers(ctx, listParamsSchema.parse({})));
    expect(table.headers).toContain("Warehouse");
    const xlsx = await writeXlsxFile([
      table.headers.map((value) => ({ value })),
      ...table.rows.map((row) =>
        row.map((value) =>
          value === null
            ? null
            : typeof value === "number"
              ? { value, type: Number }
              : { value, type: String },
        ),
      ),
    ]).toBuffer();

    // The other Taqseem: its warehouse has another name, and it has "shahdara town" already.
    const suffix = randomUUID().slice(0, 8);
    const tenant = await prisma.tenant.create({
      data: { name: `J ${suffix}`, slug: `j-${suffix}` },
    });
    const other: ServiceCtx = {
      db: createTenantDb(tenant.id),
      user: { ...ctx.user, tenantId: tenant.id },
    };
    const godown = await createWarehouse(other, { name: "Godown 2" });
    const shahdara = await createArea(other, { warehouseId: godown.id, name: "shahdara town" });

    const preview = await previewImport(other, "customers", { name: "c.xlsx", bytes: xlsx });
    expect(preview).toMatchObject({
      newCount: 3,
      errorCount: 0,
      newAreas: ["Model Town (Godown 2)"],
    });
    await commitImport(other, "customers", { name: "c.xlsx", bytes: xlsx }, randomUUID());

    const moved = await other.db.customer.findMany({
      orderBy: { name: "asc" },
      include: { area: { include: { warehouse: true } } },
    });
    expect(
      moved.map((c) => [
        c.name,
        c.type,
        c.phone,
        c.whatsapp,
        c.area?.name ?? null,
        c.area?.warehouse.name ?? null,
        c.routeSequence,
        c.creditLimit?.toFixed(2) ?? null,
      ]),
    ).toEqual([
      [
        "Ali Khan",
        "BIKE_SUPPLIER",
        "+92 3001234567",
        "+92 3001234567",
        "shahdara town",
        "Godown 2",
        2,
        "25000.00",
      ],
      ["Bilal", "DEALER", "+92 3011111111", null, "Model Town", "Godown 2", 1, null],
      ["Chand", "RETAILER", null, null, null, null, null, null],
    ]);
    expect(moved[0]!.areaId).toBe(shahdara.id);
  });
});
