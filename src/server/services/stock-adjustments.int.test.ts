import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "../auth/permissions";
import { prisma } from "../db/client";
import { createTenantDb } from "../db/tenant";
import type { ServiceCtx } from "./master/common";
import { createCompany } from "./master/companies";
import { createProduct } from "./master/products";
import { createWarehouse } from "./master/warehouses";
import { createGoodsReceipt } from "./purchasing/goods-receipts";
import {
  approveAdjustment,
  listAdjustments,
  rejectAdjustment,
  requestAdjustment,
} from "./stock-adjustments";

async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({ data: { name: `A ${suffix}`, slug: `a-${suffix}` } });
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `a-${suffix}@t.local`,
      name: "Owner",
      role: "OWNER",
      passwordHash: "x",
    },
  });
  const staffUser = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `s-${suffix}@t.local`,
      name: "Sana",
      role: "STAFF",
      passwordHash: "x",
    },
  });
  const ctx: ServiceCtx = {
    db: createTenantDb(tenant.id),
    user: { id: owner.id, role: "OWNER", tenantId: tenant.id },
  };
  const staff: ServiceCtx = {
    ...ctx,
    user: { id: staffUser.id, role: "STAFF", tenantId: tenant.id },
  };
  const wh = await createWarehouse(ctx, { name: "Main" });
  const company = await createCompany(ctx, {
    warehouseId: wh.id,
    name: "Crunchy",
    paymentTermsDays: "15",
    openingBalance: "",
  });
  const chips = await createProduct(ctx, {
    companyId: company.id,
    code: "CB01",
    name: "Chips",
    purchaseRate: "100",
    saleRate: "120",
    effectiveFrom: "2026-10-01",
  });
  await createGoodsReceipt(ctx, {
    companyId: company.id,
    receivedDate: "2026-10-01",
    lines: [{ productId: chips.id, quantity: "10" }], // 120 packets
  });
  return { ctx, staff, wh, chips };
}

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});

const stock = async () => {
  const groups = await t.ctx.db.stockMovement.groupBy({
    by: ["bucket"],
    where: { productId: t.chips.id },
    _sum: { quantity: true },
  });
  const of = (b: string) => groups.find((g) => g.bucket === b)?._sum.quantity ?? 0;
  return { saleable: of("SALEABLE"), damaged: of("DAMAGED") };
};
const adjust = (extra: object, ctx = t.ctx) =>
  requestAdjustment(ctx, { productId: t.chips.id, ...extra });

describe("stock adjustments", () => {
  it("the owner's own adjustment applies at once, out of the oldest batch", async () => {
    const requestId = randomUUID();
    const a = await adjust({ kind: "SHORT", reason: "THEFT", quantity: "5", requestId });
    expect((await adjust({ kind: "SHORT", reason: "THEFT", quantity: "5", requestId })).id).toBe(
      a.id,
    );
    expect(a.status).toBe("APPROVED");
    expect(await stock()).toEqual({ saleable: 115, damaged: 0 });
    const moves = await t.ctx.db.stockMovement.findMany({
      where: { referenceType: "StockAdjustment", referenceId: a.id },
    });
    expect(moves.map((m) => [m.type, m.quantity, m.batchId !== null])).toEqual([
      ["ADJUSTMENT", -5, true],
    ]);
  });

  it("a staff request waits for the owner; damage moves saleable to damaged stock", async () => {
    const r = await adjust({ kind: "DAMAGED", quantity: "12", note: "rain leak" }, t.staff);
    expect(r.status).toBe("PENDING");
    expect(await stock()).toEqual({ saleable: 120, damaged: 0 });
    await expect(approveAdjustment(t.staff, { id: r.id })).rejects.toThrow(ForbiddenError);
    await approveAdjustment(t.ctx, { id: r.id });
    expect(await stock()).toEqual({ saleable: 108, damaged: 12 });
    await expect(approveAdjustment(t.ctx, { id: r.id })).rejects.toThrow(/already approved/);

    const extra = await adjust({ kind: "EXTRA", reason: "COUNTING_ERROR", quantity: "3" }, t.staff);
    await rejectAdjustment(t.ctx, { id: extra.id });
    expect(await stock()).toEqual({ saleable: 108, damaged: 12 });

    const list = await listAdjustments(t.staff, { page: 1 });
    expect(list.rows.map((x) => [x.kind, x.status, x.requestedBy, x.decidedBy])).toEqual([
      ["EXTRA", "REJECTED", "Sana", "Owner"],
      ["DAMAGED", "APPROVED", "Sana", "Owner"],
    ]);
    expect(list.pending).toBe(0);
    expect(
      await t.ctx.db.auditLog.count({ where: { entityType: "StockAdjustment", entityId: r.id } }),
    ).toBe(2);
  });

  it("can't take out more than is in stock, and checks the reason", async () => {
    const big = await adjust({ kind: "SHORT", reason: "COUNTING_ERROR", quantity: "121" }, t.staff);
    await expect(approveAdjustment(t.ctx, { id: big.id })).rejects.toThrow(
      /Only 10 dz of Chips is in stock/,
    );
    await expect(adjust({ kind: "SHORT", quantity: "1" })).rejects.toThrow(/Choose the reason/);
    await expect(adjust({ kind: "EXTRA", reason: "THEFT", quantity: "1" })).rejects.toThrow(
      /Theft/,
    );
    await expect(adjust({ kind: "SHORT", reason: "OTHER", quantity: "1" })).rejects.toThrow(
      /Say what happened/,
    );
    await expect(adjust({ kind: "SHORT", reason: "THEFT", quantity: "0" })).rejects.toThrow();
  });
});
