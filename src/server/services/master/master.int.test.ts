import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "../../auth/permissions";
import { prisma } from "../../db/client";
import { createTenantDb } from "../../db/tenant";
import { ServiceError } from "../errors";
import { createBike } from "./bikes";
import { deleteRecord, setRecordActive, type ServiceCtx } from "./common";
import { createCompany, getCompany, listCompanies, updateCompany } from "./companies";
import { createCustomer, getCustomer, listCustomers, updateCustomer } from "./customers";
import { createProduct, getProduct, listProducts, updateProduct } from "./products";
import { createStaff } from "./staff";
import { createWarehouse, updateWarehouse } from "./warehouses";
import { createArea } from "./areas";

const listAll = { q: undefined, status: "all" as const, page: 1 };

async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({ data: { name: `M ${suffix}`, slug: `m-${suffix}` } });
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `o-${suffix}@t.local`,
      name: "Owner",
      role: "OWNER",
      passwordHash: "x",
    },
  });
  const db = createTenantDb(tenant.id);
  const ctx: ServiceCtx = { db, user: { id: owner.id, role: "OWNER", tenantId: tenant.id } };
  const as = (role: "ACCOUNTANT" | "STAFF"): ServiceCtx => ({
    ...ctx,
    user: { ...ctx.user, role },
  });
  const warehouse = await createWarehouse(ctx, { name: "Main" });
  const company = await createCompany(ctx, {
    warehouseId: warehouse.id,
    name: "Crunchy",
    paymentTermsDays: "15",
  });
  return { tenant, ctx, as, warehouse, company };
}

const productInput = (companyId: string, extra: object = {}) => ({
  companyId,
  code: `p${randomUUID().slice(0, 6)}`,
  name: "Masala Chips",
  purchaseRate: "1200",
  saleRate: "1320",
  discountType: "AMOUNT_PER_UNIT",
  discountValue: "200",
  slabs: [{ fromDozens: "25", value: "250" }],
  minStockLevel: "10",
  effectiveFrom: "2026-10-01",
  ...extra,
});

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});

describe("idempotent creates and readable duplicates", () => {
  it("returns the same record when a create is retried with the same requestId", async () => {
    const requestId = randomUUID();
    const first = await createCustomer(t.ctx, { requestId, name: "Ali", type: "RETAILER" });
    const retry = await createCustomer(t.ctx, { requestId, name: "Ali", type: "RETAILER" });
    expect(retry.id).toBe(first.id);
    expect(await t.ctx.db.customer.count()).toBe(1);
  });

  it("explains duplicate names and codes", async () => {
    await expect(createWarehouse(t.ctx, { name: "Main" })).rejects.toThrow("already exists");
    const product = productInput(t.company.id);
    await createProduct(t.ctx, product);
    await expect(createProduct(t.ctx, { ...product, name: "Other" })).rejects.toThrow(
      "already uses this code",
    );
  });
});

describe("products and price history", () => {
  it("records price history and slabs on create, and only on rate changes after that", async () => {
    const product = await createProduct(t.ctx, productInput(t.company.id));
    let full = await getProduct(t.ctx, product.id);
    expect(full.priceHistory).toHaveLength(1);
    expect(full.discountTiers.map((s) => [s.minQuantity, s.discountValue.toFixed(2)])).toEqual([
      [50, "250.00"],
    ]);
    expect(full.minStockLevel).toBe(20);

    // Name-only change: no new history row.
    await updateProduct(
      t.ctx,
      product.id,
      productInput(t.company.id, { code: product.code, name: "Masala Chips Rs20" }),
    );
    full = await getProduct(t.ctx, product.id);
    expect(full.priceHistory).toHaveLength(1);

    // Rate and slab change: new history row with the slabs snapshot.
    await updateProduct(
      t.ctx,
      product.id,
      productInput(t.company.id, {
        code: product.code,
        saleRate: "1350",
        slabs: [
          { fromDozens: "50", value: "300" },
          { fromDozens: "25", value: "260" },
        ],
        effectiveFrom: "2026-10-24",
      }),
    );
    full = await getProduct(t.ctx, product.id);
    expect(full.priceHistory).toHaveLength(2);
    expect(full.priceHistory[0]!.saleRate.toFixed(2)).toBe("1350.00");
    expect(full.priceHistory[0]!.discountTiers).toEqual([
      { minQuantity: 50, discountType: "AMOUNT_PER_UNIT", discountValue: "260.00" },
      { minQuantity: 100, discountType: "AMOUNT_PER_UNIT", discountValue: "300.00" },
    ]);
    expect(full.discountTiers).toHaveLength(2);

    const audits = await prisma.auditLog.findMany({
      where: { entityId: product.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audits.map((a) => a.action)).toEqual(["CREATE", "UPDATE", "UPDATE"]);
    expect(audits[2]!.oldValue).toMatchObject({ saleRate: "1320" });
  });

  it("hides purchase rates from staff", async () => {
    await createProduct(t.ctx, productInput(t.company.id));
    const staffView = await listProducts(t.as("STAFF"), listAll);
    expect(staffView.rows[0]!.purchaseRate).toBeNull();
    expect(staffView.rows[0]!.saleRate.toFixed(2)).toBe("1320.00");
    const ownerView = await listProducts(t.ctx, listAll);
    expect(ownerView.rows[0]!.purchaseRate?.toFixed(2)).toBe("1200.00");
  });

  it("only owners create or edit master data", async () => {
    for (const role of ["ACCOUNTANT", "STAFF"] as const) {
      await expect(createProduct(t.as(role), productInput(t.company.id))).rejects.toThrow(
        ForbiddenError,
      );
      await expect(createCustomer(t.as(role), { name: "X", type: "RETAILER" })).rejects.toThrow(
        ForbiddenError,
      );
    }
  });
});

describe("opening balances post differences to the ledger", () => {
  it("company: what we owe; changes post only the difference", async () => {
    await updateCompany(t.ctx, t.company.id, {
      warehouseId: t.warehouse.id,
      name: "Crunchy",
      paymentTermsDays: "15",
      openingBalance: "1000",
    });
    await updateCompany(t.ctx, t.company.id, {
      warehouseId: t.warehouse.id,
      name: "Crunchy",
      paymentTermsDays: "15",
      openingBalance: "1500",
    });
    expect((await getCompany(t.ctx, t.company.id)).openingBalance).toBe("1500.00");
    const entries = await t.ctx.db.ledgerEntry.findMany({
      where: { companyId: t.company.id },
      orderBy: { createdAt: "asc" },
    });
    expect(entries.map((e) => [e.debit.toFixed(2), e.credit.toFixed(2)])).toEqual([
      ["0.00", "1000.00"],
      ["0.00", "500.00"],
    ]);
    const list = await listCompanies(t.ctx, listAll);
    expect(list.rows[0]!.payable).toBe("1500.00");
    // Staff do not see payables.
    expect((await listCompanies(t.as("STAFF"), listAll)).rows[0]!.payable).toBeNull();
  });

  it("customer: per company, and the list shows the total pending", async () => {
    const other = await createCompany(t.ctx, {
      warehouseId: t.warehouse.id,
      name: "Golden",
      paymentTermsDays: "30",
    });
    const customer = await createCustomer(t.ctx, {
      name: "Ali",
      type: "RETAILER",
      openingBalances: { [t.company.id]: "5000", [other.id]: "" },
    });
    await updateCustomer(t.ctx, customer.id, {
      name: "Ali",
      type: "RETAILER",
      openingBalances: { [t.company.id]: "4000", [other.id]: "-250" },
    });
    const full = await getCustomer(t.ctx, customer.id);
    expect(full.openingBalances).toEqual({ [t.company.id]: "4000.00", [other.id]: "-250.00" });
    const list = await listCustomers(t.ctx, listAll);
    expect(list.rows[0]!.balance).toBe("3750.00");
    // Every customer entry carries a company (CLAUDE.md rule 3).
    const entries = await t.ctx.db.ledgerEntry.findMany({ where: { customerId: customer.id } });
    expect(entries.every((e) => e.companyId)).toBe(true);
  });
});

describe("deactivate instead of delete once used", () => {
  it("deletes an unused record, but refuses one that has other records", async () => {
    const spare = await createWarehouse(t.ctx, { name: "Spare" });
    await deleteRecord(t.ctx, "Warehouse", { id: spare.id });
    expect(await t.ctx.db.warehouse.findUnique({ where: { id: spare.id } })).toBeNull();

    await expect(deleteRecord(t.ctx, "Warehouse", { id: t.warehouse.id })).rejects.toThrow(
      "Deactivate it instead",
    );
    await setRecordActive(t.ctx, "Warehouse", { id: t.warehouse.id }, false);
    expect(
      (await t.ctx.db.warehouse.findUniqueOrThrow({ where: { id: t.warehouse.id } })).isActive,
    ).toBe(false);

    const deleted = await prisma.auditLog.findFirst({
      where: { entityId: spare.id, action: "DELETE" },
    });
    expect(deleted?.oldValue).toMatchObject({ name: "Spare" });
  });

  it("a customer with an opening balance cannot be deleted", async () => {
    const customer = await createCustomer(t.ctx, {
      name: "Ali",
      type: "RETAILER",
      openingBalances: { [t.company.id]: "100" },
    });
    await expect(deleteRecord(t.ctx, "Customer", { id: customer.id })).rejects.toThrow(
      ServiceError,
    );
  });

  it("products keep their price history, so they are only deactivated", async () => {
    const product = await createProduct(t.ctx, productInput(t.company.id));
    await expect(deleteRecord(t.ctx, "Product", { id: product.id })).rejects.toThrow(
      "Deactivate it instead",
    );
  });
});

describe("references and tenant isolation", () => {
  it("bikes only take active drivers", async () => {
    const office = await createStaff(t.ctx, {
      name: "Kamran",
      role: "OFFICE",
      monthlySalary: "45000",
    });
    await expect(
      createBike(t.ctx, { name: "Bike 1", capacity: "90", driverId: office.id }),
    ).rejects.toThrow("Driver role");
    const driver = await createStaff(t.ctx, {
      name: "Akram",
      role: "DRIVER",
      monthlySalary: "32000",
    });
    const bike = await createBike(t.ctx, { name: "Bike 1", capacity: "90", driverId: driver.id });
    expect(bike.capacity).toBe(180);
  });

  it("cannot read, edit, deactivate or reference another tenant's records", async () => {
    const other = await setup();
    const theirArea = await createArea(other.ctx, {
      warehouseId: other.warehouse.id,
      name: "Township",
    });
    await expect(updateWarehouse(t.ctx, other.warehouse.id, { name: "Hacked" })).rejects.toThrow(
      "not found",
    );
    await expect(
      setRecordActive(t.ctx, "Company", { id: other.company.id }, false),
    ).rejects.toThrow("not found");
    await expect(deleteRecord(t.ctx, "Warehouse", { id: other.warehouse.id })).rejects.toThrow(
      "not found",
    );
    await expect(
      createCustomer(t.ctx, { name: "X", type: "RETAILER", areaId: theirArea.id }),
    ).rejects.toThrow("active area");
    await expect(createProduct(t.ctx, productInput(other.company.id))).rejects.toThrow(
      "active company",
    );
    await expect(
      createCustomer(t.ctx, {
        name: "X",
        type: "RETAILER",
        openingBalances: { [other.company.id]: "10" },
      }),
    ).rejects.toThrow("unknown company");
    expect(
      (await prisma.warehouse.findUniqueOrThrow({ where: { id: other.warehouse.id } })).name,
    ).toBe("Main");
  });
});
