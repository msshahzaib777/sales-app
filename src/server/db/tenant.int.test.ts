import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import type { Prisma } from "@/generated/prisma/client";

import { prisma } from "./client";
import { createTenantDb, type TenantDb, TenantScopeError } from "./tenant";

// Proves that the tenant data layer never returns or changes another tenant's data, for every kind
// of Prisma operation, and that the database refuses cross-tenant references.

type Fixture = Awaited<ReturnType<typeof createTenantFixture>>;

async function createTenantFixture(label: string) {
  const suffix = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({
    data: { name: `${label} ${suffix}`, slug: `${label}-${suffix}` },
  });
  const tenantId = tenant.id;
  const user = await prisma.user.create({
    data: {
      tenantId,
      email: `${label}-${suffix}@test.local`,
      name: `${label} owner`,
      role: "OWNER",
      passwordHash: "x",
    },
  });
  const warehouse = await prisma.warehouse.create({ data: { tenantId, name: "Main" } });
  const company = await prisma.company.create({
    data: { tenantId, warehouseId: warehouse.id, name: `${label} Foods` },
  });
  const product = await prisma.product.create({
    data: {
      tenantId,
      companyId: company.id,
      code: "P1",
      name: `${label} chips`,
      purchaseRate: 100,
      saleRate: 120,
    },
  });
  const customer = await prisma.customer.create({ data: { tenantId, name: `${label} customer` } });
  await prisma.ledgerEntry.create({
    data: {
      tenantId,
      partyType: "CUSTOMER",
      customerId: customer.id,
      companyId: company.id,
      type: "OPENING_BALANCE",
      entryDate: new Date("2026-10-01"),
      debit: label === "a" ? 1000 : 50000,
    },
  });
  await prisma.auditLog.create({
    data: {
      tenantId,
      userId: user.id,
      action: "CREATE",
      entityType: "Customer",
      entityId: customer.id,
    },
  });
  return { tenantId, tenant, user, warehouse, company, product, customer };
}

let a: Fixture;
let b: Fixture;
let dbA: TenantDb;

beforeAll(async () => {
  a = await createTenantFixture("a");
  b = await createTenantFixture("b");
  dbA = createTenantDb(a.tenantId);
});

describe("reads never return another tenant's rows", () => {
  it("findMany and findFirst", async () => {
    const customers = await dbA.customer.findMany();
    expect(customers.map((c) => c.id)).toEqual([a.customer.id]);
    expect(await dbA.customer.findFirst({ where: { id: b.customer.id } })).toBeNull();
    // Even when the caller explicitly asks for the other tenant.
    expect(await dbA.customer.findMany({ where: { tenantId: b.tenantId } })).toEqual([]);
  });

  it("findUnique and findUniqueOrThrow by id and by compound key", async () => {
    expect(await dbA.product.findUnique({ where: { id: b.product.id } })).toBeNull();
    await expect(dbA.product.findUniqueOrThrow({ where: { id: b.product.id } })).rejects.toThrow();
    expect(
      await dbA.product.findUnique({
        where: { tenantId_code: { tenantId: b.tenantId, code: "P1" } },
      }),
    ).toBeNull();
    expect((await dbA.product.findUnique({ where: { id: a.product.id } }))?.id).toBe(a.product.id);
  });

  it("count, aggregate and groupBy", async () => {
    expect(await dbA.ledgerEntry.count()).toBe(1);
    const sum = await dbA.ledgerEntry.aggregate({ _sum: { debit: true } });
    expect(sum._sum.debit?.toFixed(2)).toBe("1000.00");
    const groups = await dbA.ledgerEntry.groupBy({ by: ["customerId"], _sum: { debit: true } });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.customerId).toBe(a.customer.id);
  });

  it("included relations stay inside the tenant", async () => {
    const company = await dbA.company.findUniqueOrThrow({
      where: { id: a.company.id },
      include: { products: true, warehouse: true, ledgerEntries: true },
    });
    expect(company.products.map((p) => p.id)).toEqual([a.product.id]);
    expect(company.warehouse.id).toBe(a.warehouse.id);
  });

  it("users and the audit log are scoped too", async () => {
    expect((await dbA.user.findMany()).map((u) => u.id)).toEqual([a.user.id]);
    expect(await dbA.user.findUnique({ where: { email: b.user.email } })).toBeNull();
    const audit = await dbA.auditLog.findMany();
    expect(audit.every((row) => row.tenantId === a.tenantId)).toBe(true);
  });

  it("the Tenant row: only its own", async () => {
    expect((await dbA.tenant.findUnique({ where: { id: a.tenantId } }))?.id).toBe(a.tenantId);
    expect(await dbA.tenant.findUnique({ where: { id: b.tenantId } })).toBeNull();
    expect(await dbA.tenant.findFirst({ where: { slug: b.tenant.slug } })).toBeNull();
    await expect(dbA.tenant.findMany()).rejects.toThrow(TenantScopeError);
  });
});

describe("writes never touch another tenant's rows", () => {
  it("update and delete of another tenant's row fail; updateMany/deleteMany match nothing", async () => {
    await expect(
      dbA.customer.update({ where: { id: b.customer.id }, data: { name: "hacked" } }),
    ).rejects.toThrow();
    expect(
      (await dbA.customer.updateMany({ where: { id: b.customer.id }, data: { name: "hacked" } }))
        .count,
    ).toBe(0);
    await expect(dbA.customer.delete({ where: { id: b.customer.id } })).rejects.toThrow();
    expect((await dbA.customer.deleteMany({ where: { id: b.customer.id } })).count).toBe(0);
    const untouched = await prisma.customer.findUniqueOrThrow({ where: { id: b.customer.id } });
    expect(untouched.name).toBe("b customer");
  });

  it("upsert on another tenant's row creates in our tenant instead of changing theirs", async () => {
    const row = await dbA.documentSequence.upsert({
      where: { tenantId_key: { tenantId: b.tenantId, key: "TEST" } },
      create: { tenantId: a.tenantId, key: "TEST", nextValue: 5 },
      update: { nextValue: { increment: 1 } },
    });
    expect(row.tenantId).toBe(a.tenantId);
    expect(
      await prisma.documentSequence.findUnique({
        where: { tenantId_key: { tenantId: b.tenantId, key: "TEST" } },
      }),
    ).toBeNull();
  });

  it("creates are stamped with our tenant and cannot target another", async () => {
    // Types ask callers to pass tenantId; at runtime the layer stamps it even when missing.
    const data = { name: `Extra ${randomUUID()}` } as Prisma.WarehouseUncheckedCreateInput;
    const warehouse = await dbA.warehouse.create({ data });
    expect(warehouse.tenantId).toBe(a.tenantId);
    const explicit = await dbA.warehouse.create({
      data: { tenantId: a.tenantId, name: `Extra ${randomUUID()}` },
    });
    expect(explicit.tenantId).toBe(a.tenantId);
    await expect(
      dbA.warehouse.create({ data: { name: "x", tenantId: b.tenantId } }),
    ).rejects.toThrow(TenantScopeError);
    await expect(
      dbA.customer.update({ where: { id: a.customer.id }, data: { tenantId: b.tenantId } }),
    ).rejects.toThrow(TenantScopeError);
  });

  it("the database refuses references to another tenant's records", async () => {
    // Our company pointing at their warehouse.
    await expect(
      dbA.company.create({
        data: { tenantId: a.tenantId, name: "Sneaky", warehouseId: b.warehouse.id },
      }),
    ).rejects.toThrow();
    // A ledger entry for their customer.
    await expect(
      dbA.ledgerEntry.create({
        data: {
          tenantId: a.tenantId,
          partyType: "CUSTOMER",
          customerId: b.customer.id,
          companyId: a.company.id,
          type: "ADJUSTMENT",
          entryDate: new Date(),
          debit: 1,
        },
      }),
    ).rejects.toThrow();
  });

  it("nested creates inherit the parent's tenant", async () => {
    const order = await dbA.salesOrder.create({
      data: {
        tenantId: a.tenantId,
        number: Math.floor(Math.random() * 1e9),
        customerId: a.customer.id,
        warehouseId: a.warehouse.id,
        orderDate: new Date(),
        deliveryDate: new Date(),
        lines: {
          create: [
            {
              productId: a.product.id,
              companyId: a.company.id,
              quantity: 2,
              rate: 120,
              grossAmount: 120,
              netAmount: 120,
            },
          ],
        },
      },
      include: { lines: true },
    });
    expect(order.lines[0]!.tenantId).toBe(a.tenantId);
  });
});

describe("escape hatches are closed", () => {
  it("raw SQL is blocked, including inside transactions", async () => {
    // Not even in the type, and blocked at runtime for code that casts its way around the type.
    const untyped = dbA as unknown as { $queryRaw: (sql: TemplateStringsArray) => unknown };
    expect(() => untyped.$queryRaw`SELECT 1`).toThrow(TenantScopeError);
    await expect(
      dbA.$transaction(async (tx) => {
        (tx as unknown as { $executeRawUnsafe: (sql: string) => unknown }).$executeRawUnsafe(
          "SELECT 1",
        );
      }),
    ).rejects.toThrow(TenantScopeError);
  });

  it("transactions stay scoped", async () => {
    const ids = await dbA.$transaction(async (tx) =>
      (await tx.customer.findMany()).map((c) => c.id),
    );
    expect(ids).toEqual([a.customer.id]);
  });
});
