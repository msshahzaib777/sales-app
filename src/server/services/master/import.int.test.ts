import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "../../auth/permissions";
import { prisma } from "../../db/client";
import { createTenantDb } from "../../db/tenant";
import { createArea } from "./areas";
import type { ServiceCtx } from "./common";
import { createCompany } from "./companies";
import { getCustomer } from "./customers";
import { commitImport, previewImport } from "./import";
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
    expect(result).toEqual({ created: 2, updated: 0, skipped: 1 });
    const cb01 = await ctx.db.product.findUniqueOrThrow({
      where: { tenantId_code: { tenantId: ctx.user.tenantId, code: "CB01" } },
      include: { priceHistory: true },
    });
    expect(cb01).toMatchObject({ discountType: "AMOUNT_PER_UNIT", minStockLevel: 20 });
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
    expect(result).toEqual({ created: 0, updated: 1, skipped: 1 });
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

describe("customer import", () => {
  const CUSTOMERS = [
    "Name,Shop name,Type,Phone,Area,Credit limit,Opening: Crunchy Bites Foods",
    "Ali Khan,Khan Store,Retailer,0300-1234567,Shahdara Town,25000,5000",
    "Zubair,,Wholesaler,0301-7654321,,,",
    "Nobody,,Retailer,,Atlantis,,",
  ].join("\n");

  it("imports customers with opening balances as ledger entries", async () => {
    const result = await commitImport(ctx, "customers", file("c.csv", CUSTOMERS), randomUUID());
    expect(result).toEqual({ created: 2, updated: 0, skipped: 1 });
    const ali = await ctx.db.customer.findFirstOrThrow({ where: { name: "Ali Khan" } });
    expect((await getCustomer(ctx, ali.id)).openingBalances).toEqual({ [crunchyId]: "5000.00" });
    expect(ali.creditLimit?.toFixed(2)).toBe("25000.00");

    // Importing the same file again finds the existing customers instead of duplicating them.
    const again = await previewImport(ctx, "customers", file("c.csv", CUSTOMERS));
    expect(again).toMatchObject({ newCount: 0, errorCount: 3 });
    await expect(
      commitImport(ctx, "customers", file("c.csv", CUSTOMERS), randomUUID()),
    ).rejects.toThrow("no valid rows");
    expect(await ctx.db.customer.count()).toBe(2);
  });
});
