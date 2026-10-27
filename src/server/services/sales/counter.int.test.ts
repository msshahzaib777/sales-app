import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "../../auth/permissions";
import { prisma } from "../../db/client";
import { createTenantDb } from "../../db/tenant";
import { getDashboard } from "../dashboard";
import { getStockCard } from "../inventory";
import { createArea } from "../master/areas";
import type { ServiceCtx } from "../master/common";
import { createCompany } from "../master/companies";
import { createCustomer } from "../master/customers";
import { createProduct } from "../master/products";
import { createWarehouse } from "../master/warehouses";
import { createGoodsReceipt } from "../purchasing/goods-receipts";
import { dailyReport } from "../reports/daily";
import { createCounterSale } from "./counter";
import { listSalesOrders } from "./orders";
import { customerPending, openOrdersTotal } from "./positions";

async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({ data: { name: `C ${suffix}`, slug: `c-${suffix}` } });
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `c-${suffix}@t.local`,
      name: "Owner",
      role: "OWNER",
      passwordHash: "x",
    },
  });
  const ctx: ServiceCtx = {
    db: createTenantDb(tenant.id),
    user: { id: owner.id, role: "OWNER", tenantId: tenant.id },
  };
  const as = (role: "STAFF" | "ACCOUNTANT"): ServiceCtx => ({
    ...ctx,
    user: { ...ctx.user, role },
  });
  const main = await createWarehouse(ctx, { name: "Main" });
  const area = await createArea(ctx, { warehouseId: main.id, name: "Shahdara" });
  const crunchy = await createCompany(ctx, {
    warehouseId: main.id,
    name: "Crunchy",
    paymentTermsDays: "15",
  });
  // 228 a dozen less 4 = 224.
  const chips = await createProduct(ctx, {
    companyId: crunchy.id,
    code: "CB01",
    name: "Chips",
    purchaseRate: "100",
    saleRate: "228",
    discountType: "AMOUNT_PER_UNIT",
    discountValue: "4",
    effectiveFrom: "2026-10-01",
  });
  await createGoodsReceipt(ctx, {
    companyId: crunchy.id,
    receivedDate: "2026-10-01",
    lines: [{ productId: chips.id, quantity: "30" }],
  });
  const customer = await createCustomer(ctx, {
    name: "Ali Khan",
    type: "RETAILER",
    areaId: area.id,
    creditLimit: "10000",
    openingBalances: { [crunchy.id]: "4000" },
  });
  return { ctx, as, main, crunchy, chips, customer };
}

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});

const DAY = "2026-10-20";
const sale = (quantity: string, extra: object = {}) => ({
  customerId: t.customer.id,
  saleDate: DAY,
  lines: [{ productId: t.chips.id, quantity }],
  ...extra,
});

const onHand = async () =>
  (
    await t.ctx.db.stockMovement.aggregate({
      where: { productId: t.chips.id, bucket: "SALEABLE" },
      _sum: { quantity: true },
    })
  )._sum.quantity;

describe("counter sale", () => {
  it("takes the stock out, posts the bill and the payment, with no trip or day-end", async () => {
    const requestId = randomUUID();
    // 5 dz × 224 = 1120; 500 paid in cash, 620 on account.
    const input = sale("5", { requestId, paidAmount: "500", method: "CASH" });
    const r = await createCounterSale(t.as("STAFF"), input);
    expect(await createCounterSale(t.as("STAFF"), input)).toMatchObject({
      id: r.id,
      repeated: true,
    });

    const order = await t.ctx.db.salesOrder.findUniqueOrThrow({
      where: { id: r.id },
      include: { bill: true, payments: true },
    });
    expect(order).toMatchObject({ fulfilment: "COUNTER", status: "DELIVERED", tripId: null });
    expect(order.reconciledAt).not.toBeNull();
    expect(order.bill!.postedAt).not.toBeNull();
    expect(order.bill!.netAmount.toFixed(2)).toBe("1120.00");
    expect(order.bill!.previousBalance.toFixed(2)).toBe("4000.00");
    expect(order.payments.map((p) => [p.amount.toFixed(2), p.method, p.collectedVia])).toEqual([
      ["500.00", "CASH", "OFFICE"],
    ]);

    expect(await onHand()).toBe(25 * 12);
    const card = await getStockCard(t.ctx, t.chips.id, {});
    expect(card.rows.at(-1)).toMatchObject({ typeLabel: "Counter sale", quantity: -60 });
    expect((await customerPending(t.ctx.db, t.customer.id)).total.toFixed(2)).toBe("4620.00");
    // Delivered at once: it reserves nothing and is never planned on a trip.
    expect((await openOrdersTotal(t.ctx.db, t.customer.id)).toFixed(2)).toBe("0.00");

    const list = await listSalesOrders(t.ctx, { page: 1, fulfilment: "COUNTER" });
    expect(list.rows.map((o) => o.id)).toEqual([r.id]);
    expect((await listSalesOrders(t.ctx, { page: 1, fulfilment: "DELIVERY" })).total).toBe(0);
    const audit = await t.ctx.db.auditLog.count({ where: { entityId: r.id, action: "POST" } });
    expect(audit).toBe(1);
  });

  it("refuses when the warehouse is short, and posts nothing", async () => {
    await expect(createCounterSale(t.ctx, sale("31", { allowOverCredit: "true" }))).rejects.toThrow(
      /Not enough stock.*Chips/,
    );
    expect(await t.ctx.db.salesOrder.count()).toBe(0);
    expect(await t.ctx.db.ledgerEntry.count({ where: { type: "SALES_BILL" } })).toBe(0);
    expect(await onHand()).toBe(30 * 12);
  });

  it("goes on credit up to the limit; past it only the owner may allow it", async () => {
    // Pending 4000 + 30 dz × 224 = 6720 → 10720, past the 10000 limit.
    await expect(createCounterSale(t.as("STAFF"), sale("30"))).rejects.toThrow(
      /past their credit limit/,
    );
    await expect(createCounterSale(t.ctx, sale("30"))).rejects.toThrow(/Tick "Allow/);
    // Paying 1000 now leaves 5720 on account: 9720, within the limit.
    const paid = await createCounterSale(t.as("STAFF"), sale("30", { paidAmount: "1000" }));
    expect(paid.repeated).toBe(false);
    expect((await customerPending(t.ctx.db, t.customer.id)).total.toFixed(2)).toBe("9720.00");
  });

  it("the owner may allow a sale past the limit", async () => {
    await createCounterSale(t.ctx, sale("30", { allowOverCredit: "true" }));
    expect((await customerPending(t.ctx.db, t.customer.id)).total.toFixed(2)).toBe("10720.00");
  });

  it("a cheque needs its number, bank and date", async () => {
    await expect(
      createCounterSale(t.ctx, sale("1", { paidAmount: "224", method: "CHEQUE" })),
    ).rejects.toThrow(/cheque number/);
    await createCounterSale(
      t.ctx,
      sale("1", {
        paidAmount: "224",
        method: "CHEQUE",
        chequeNo: "123",
        bankName: "HBL",
        chequeDate: DAY,
      }),
    );
    const cheque = await t.ctx.db.cheque.findFirstOrThrow();
    expect([cheque.chequeNo, cheque.status]).toEqual(["123", "PENDING"]);
  });

  it("shows apart from deliveries on the daily report and the dashboard", async () => {
    await createCounterSale(t.ctx, sale("2"));
    const date = new Date(`${DAY}T00:00:00.000Z`);
    const r = await dailyReport(t.ctx, date);
    expect(r.counter.sales).toBe(1);
    expect(r.counter.billed.toFixed(2)).toBe("448.00");
    expect(r.deliveries.orders).toBe(0);
    expect(r.soldTotals.quantity).toBe(24);
    const d = await getDashboard(t.ctx, { date });
    expect(d.work.day.counter.sales).toBe(1);
    expect(d.work.day.orders).toBe(0);
  });

  it("is not allowed without operations access", async () => {
    const platform: ServiceCtx = { ...t.ctx, user: { ...t.ctx.user, role: "SUPER_ADMIN" } };
    await expect(createCounterSale(platform, sale("1"))).rejects.toThrow(ForbiddenError);
  });
});
