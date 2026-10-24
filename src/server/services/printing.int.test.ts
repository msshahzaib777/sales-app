import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "../auth/permissions";
import { prisma } from "../db/client";
import { createTenantDb } from "../db/tenant";
import { ServiceError } from "./errors";
import type { ServiceCtx } from "./master/common";
import { createCompany } from "./master/companies";
import { createCustomer } from "./master/customers";
import { createProduct } from "./master/products";
import { createWarehouse } from "./master/warehouses";
import { createGoodsReceipt } from "./purchasing/goods-receipts";
import { getBillViews } from "./sales/bills";
import { createSalesOrder } from "./sales/orders";
import { getPrintProfile, setLogo, updateBusinessSettings } from "./settings";
import { getCustomerStatement } from "./statements";

// Task 7: print settings, logo, customer statement and bulk bill printing.

async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({ data: { name: `P ${suffix}`, slug: `p-${suffix}` } });
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `p-${suffix}@t.local`,
      name: "Owner",
      role: "OWNER",
      passwordHash: "x",
    },
  });
  const ctx: ServiceCtx = {
    db: createTenantDb(tenant.id),
    user: { id: owner.id, role: "OWNER", tenantId: tenant.id },
  };
  const as = (role: "ACCOUNTANT" | "STAFF"): ServiceCtx => ({
    ...ctx,
    user: { ...ctx.user, role },
  });
  const wh = await createWarehouse(ctx, { name: "Main" });
  const crunchy = await createCompany(ctx, {
    warehouseId: wh.id,
    name: "Crunchy",
    paymentTermsDays: "15",
    openingBalance: "",
  });
  const golden = await createCompany(ctx, {
    warehouseId: wh.id,
    name: "Golden",
    paymentTermsDays: "30",
    openingBalance: "",
  });
  const chips = await createProduct(ctx, {
    companyId: crunchy.id,
    code: "CB01",
    name: "Chips",
    purchaseRate: "100",
    saleRate: "200",
    effectiveFrom: "2026-10-01",
  });
  const nimko = await createProduct(ctx, {
    companyId: golden.id,
    code: "GC01",
    name: "Nimko",
    purchaseRate: "100",
    saleRate: "150",
    effectiveFrom: "2026-10-01",
  });
  for (const [companyId, productId] of [
    [crunchy.id, chips.id],
    [golden.id, nimko.id],
  ] as const)
    await createGoodsReceipt(ctx, {
      companyId,
      receivedDate: "2026-10-01",
      lines: [{ productId, quantity: "50" }],
    });
  const customer = await createCustomer(ctx, {
    name: "Ali Khan",
    type: "RETAILER",
    openingBalances: { [crunchy.id]: "3000", [golden.id]: "1000" },
  });
  return { tenant, ctx, as, wh, crunchy, golden, chips, nimko, customer };
}

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});

const settings = (extra: object = {}) => ({
  name: "Al-Madina Traders",
  address: "Shop 4, Main Bazaar",
  phone: "0300-1234567",
  billPaper: "A4",
  printMarginMm: "10",
  printFontSizePt: "11",
  ...extra,
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

describe("business and print settings", () => {
  it("defaults to A5 and a plain letterhead", async () => {
    const p = await getPrintProfile(t.as("STAFF"));
    expect(p.print).toMatchObject({ paper: "A5", marginMm: 8, fontSizePt: 10, twoPerA4: false });
    expect(p.business).toMatchObject({ name: t.tenant.name, address: null, logoUrl: null });
  });

  it("saves settings with an audit row, and drops custom sizes for standard paper", async () => {
    await updateBusinessSettings(t.ctx, settings({ billPaperWidthMm: "100", twoBillsPerA4: "on" }));
    const p = await getPrintProfile(t.ctx);
    expect(p.business).toMatchObject({ name: "Al-Madina Traders", address: "Shop 4, Main Bazaar" });
    expect(p.print).toMatchObject({
      paper: "A4",
      widthMm: null,
      marginMm: 10,
      fontSizePt: 11,
      twoPerA4: true,
    });
    const audit = await t.ctx.db.auditLog.findFirst({
      where: { entityType: "Tenant", action: "UPDATE" },
    });
    expect(audit?.oldValue).toMatchObject({ billPaper: "A5" });
    expect(audit?.newValue).toMatchObject({ billPaper: "A4", twoBillsPerA4: true });
  });

  it("needs a size for custom paper and rejects out-of-range values", async () => {
    await expect(updateBusinessSettings(t.ctx, settings({ billPaper: "CUSTOM" }))).rejects.toThrow(
      /paper width/,
    );
    await expect(updateBusinessSettings(t.ctx, settings({ printMarginMm: "40" }))).rejects.toThrow(
      /at most 30/,
    );
    await updateBusinessSettings(
      t.ctx,
      settings({ billPaper: "CUSTOM", billPaperWidthMm: "100", billPaperHeightMm: "200" }),
    );
    expect((await getPrintProfile(t.ctx)).print).toMatchObject({
      paper: "CUSTOM",
      widthMm: 100,
      heightMm: 200,
    });
  });

  it("is for the owner only", async () => {
    await expect(updateBusinessSettings(t.as("ACCOUNTANT"), settings())).rejects.toThrow(
      ForbiddenError,
    );
    await expect(setLogo(t.as("STAFF"), { bytes: PNG })).rejects.toThrow(ForbiddenError);
  });

  it("stores a logo by its real type, rejects other files, and removes it", async () => {
    await setLogo(t.ctx, { bytes: PNG });
    expect((await getPrintProfile(t.ctx)).business.logoUrl).toMatch(/^data:image\/png;base64,/);
    await expect(
      setLogo(t.ctx, { bytes: new TextEncoder().encode("<svg onload=alert(1)>") }),
    ).rejects.toThrow(/PNG, JPEG or WebP/);
    await expect(setLogo(t.ctx, { bytes: new Uint8Array(300 * 1024).fill(0xff) })).rejects.toThrow(
      /200 KB/,
    );
    await setLogo(t.ctx, null);
    expect((await getPrintProfile(t.ctx)).business.logoUrl).toBeNull();
    expect(await t.ctx.db.auditLog.count({ where: { entityType: "Tenant" } })).toBe(2);
  });
});

describe("customer statement", () => {
  it("lists entries with a running balance and the company of each", async () => {
    const s = await getCustomerStatement(t.ctx, t.customer.id, {});
    expect(s.opening.toFixed(2)).toBe("0.00");
    expect(s.rows.map((r) => r.companyName).sort()).toEqual(["Crunchy", "Golden"]);
    expect(s.rows.at(-1)!.balance.toFixed(2)).toBe("4000.00");
    expect(s.closing.toFixed(2)).toBe("4000.00");
    expect(s.byCompany.map((c) => [c.companyName, c.balance.toFixed(2)])).toEqual([
      ["Crunchy", "3000.00"],
      ["Golden", "1000.00"],
    ]);
  });

  it("filters to one company and carries earlier entries into the opening balance", async () => {
    const one = await getCustomerStatement(t.ctx, t.customer.id, { companyId: t.crunchy.id });
    expect(one.company?.name).toBe("Crunchy");
    expect(one.rows).toHaveLength(1);
    expect(one.closing.toFixed(2)).toBe("3000.00");

    const later = await getCustomerStatement(t.ctx, t.customer.id, {
      from: new Date("2099-01-01T00:00:00Z"),
    });
    expect(later.opening.toFixed(2)).toBe("4000.00");
    expect(later.rows).toHaveLength(0);
    expect(later.closing.toFixed(2)).toBe("4000.00");
  });

  it("is hidden from staff and from other tenants", async () => {
    await expect(getCustomerStatement(t.as("STAFF"), t.customer.id, {})).rejects.toThrow(
      ForbiddenError,
    );
    const other = await setup();
    await expect(getCustomerStatement(other.ctx, t.customer.id, {})).rejects.toThrow(ServiceError);
  });
});

describe("printing bills for selected orders", () => {
  it("loads each bill once, in the order given, and skips orders it cannot find", async () => {
    const book = (quantity: string) =>
      createSalesOrder(t.ctx, {
        customerId: t.customer.id,
        orderDate: "2026-10-24",
        deliveryDate: "2026-10-25",
        warehouseId: t.wh.id,
        lines: [
          { productId: t.chips.id, quantity },
          { productId: t.nimko.id, quantity: "1" },
        ],
      });
    const a = await book("2");
    const b = await book("3");
    const other = await setup();
    const { views, skipped } = await getBillViews(t.ctx, [b.id, a.id, b.id, randomUUID()]);
    expect(views.map((v) => v.order.number)).toEqual([b.number, a.number]);
    expect(views[0]!.sections).toHaveLength(2);
    expect(skipped).toBe(1);
    expect((await getBillViews(other.ctx, [a.id])).views).toHaveLength(0);
  });

  it("limits a print run to 200 bills", async () => {
    const ids = Array.from({ length: 201 }, () => randomUUID());
    await expect(getBillViews(t.ctx, ids)).rejects.toThrow(/at most 200/);
  });
});
