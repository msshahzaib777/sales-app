import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_EXPENSE_CATEGORIES } from "@/lib/expenses";

import { ForbiddenError } from "../auth/permissions";
import { prisma } from "../db/client";
import { createTenantDb } from "../db/tenant";
import {
  createExpense,
  createExpenseCategory,
  listExpenses,
  reverseExpense,
  setExpenseCategoryActive,
} from "./expenses";
import { createBike } from "./master/bikes";
import type { ServiceCtx } from "./master/common";
import { createWarehouse } from "./master/warehouses";

async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({ data: { name: `E ${suffix}`, slug: `e-${suffix}` } });
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `e-${suffix}@t.local`,
      name: "O",
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
  await ctx.db.expenseCategory.createMany({
    data: DEFAULT_EXPENSE_CATEGORIES.map((name) => ({ tenantId: tenant.id, name })),
  });
  const category = async (name: string) =>
    ctx.db.expenseCategory.findFirstOrThrow({ where: { name } });
  const wh = await createWarehouse(ctx, { name: "Main" });
  const bike = await createBike(ctx, { name: "Bike 1", warehouseId: wh.id, capacity: "90" });
  return {
    ctx,
    as,
    category,
    wh,
    bike,
    petrol: await category("Petrol"),
    rent: await category("Rent"),
  };
}

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});

const add = (extra: object, ctx = t.ctx) =>
  createExpense(ctx, { expenseDate: "2026-10-24", method: "CASH", ...extra });

describe("expenses", () => {
  it("records expenses with totals per category; a retry never doubles one", async () => {
    const requestId = randomUUID();
    const a = await add({ categoryId: t.petrol.id, amount: "1,500", bikeId: t.bike.id, requestId });
    expect((await add({ categoryId: t.petrol.id, amount: "1500", requestId })).id).toBe(a.id);
    await add({ categoryId: t.petrol.id, amount: "700", note: "Bike 1 top up" });
    await add({ categoryId: t.rent.id, amount: "25000", method: "ONLINE", paidTo: "Landlord" });
    expect([a.number, a.amount.toFixed(2), a.bikeId]).toEqual([1, "1500.00", t.bike.id]);

    const list = await listExpenses(t.ctx, { page: 1 });
    expect(list.total).toBe(3);
    expect(list.totalAmount.toFixed(2)).toBe("27200.00");
    expect(list.byCategory.map((c) => [c.name, c.amount.toFixed(2), c.count])).toEqual([
      ["Rent", "25000.00", 1],
      ["Petrol", "2200.00", 2],
    ]);
    // Filters and search.
    expect((await listExpenses(t.ctx, { page: 1, bikeId: t.bike.id })).total).toBe(1);
    expect((await listExpenses(t.ctx, { page: 1, q: "top bike" })).total).toBe(1);
    expect((await listExpenses(t.ctx, { page: 1, q: "landlord" })).total).toBe(1);
    expect((await listExpenses(t.ctx, { page: 1, method: "ONLINE" })).total).toBe(1);
    const nextDay = new Date("2026-10-25T00:00:00.000Z");
    expect((await listExpenses(t.ctx, { page: 1, from: nextDay })).total).toBe(0);
  });

  it("is reversed with a reason, never deleted, and leaves the totals", async () => {
    const a = await add({ categoryId: t.rent.id, amount: "100" });
    await reverseExpense(t.ctx, { id: a.id, reason: "entered twice" });
    await expect(reverseExpense(t.ctx, { id: a.id, reason: "again" })).rejects.toThrow(
      /already reversed/,
    );
    const list = await listExpenses(t.ctx, { page: 1 });
    expect([list.total, list.totalAmount.toFixed(2)]).toEqual([1, "0.00"]);
    expect(
      await t.ctx.db.auditLog.count({ where: { entityType: "Expense", entityId: a.id } }),
    ).toBe(2);
  });

  it("checks the amount, the category and who may record them", async () => {
    await expect(add({ categoryId: t.rent.id, amount: "0" })).rejects.toThrow();
    await expect(add({ categoryId: t.rent.id, amount: "100" }, t.as("STAFF"))).rejects.toThrow(
      ForbiddenError,
    );
    await add({ categoryId: t.rent.id, amount: "100" }, t.as("ACCOUNTANT"));
    await setExpenseCategoryActive(t.ctx, { id: t.rent.id }, false);
    await expect(add({ categoryId: t.rent.id, amount: "100" })).rejects.toThrow(/active category/);
  });

  it("adds categories without duplicates", async () => {
    const c = await createExpenseCategory(t.ctx, { name: "Tea" });
    expect(c.name).toBe("Tea");
    await expect(createExpenseCategory(t.ctx, { name: "petrol" })).rejects.toThrow(
      /already exists/,
    );
  });
});
