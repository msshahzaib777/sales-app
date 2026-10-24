import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "../../auth/permissions";
import { prisma } from "../../db/client";
import { createTenantDb } from "../../db/tenant";
import { createArea } from "../master/areas";
import type { ServiceCtx } from "../master/common";
import { createCompany } from "../master/companies";
import { createCustomer } from "../master/customers";
import { createProduct } from "../master/products";
import { createWarehouse } from "../master/warehouses";
import { createGoodsReceipt } from "../purchasing/goods-receipts";
import { getBillView } from "./bills";
import {
  approveCreditOverride,
  cancelSalesOrder,
  createSalesOrder,
  getSalesOrder,
  orderEntryContext,
  updateSalesOrder,
} from "./orders";
import { stockPositions } from "./positions";

async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({ data: { name: `S ${suffix}`, slug: `s-${suffix}` } });
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `s-${suffix}@t.local`,
      name: "Owner",
      role: "OWNER",
      passwordHash: "x",
    },
  });
  const ctx: ServiceCtx = {
    db: createTenantDb(tenant.id),
    user: { id: owner.id, role: "OWNER", tenantId: tenant.id },
  };
  const staff: ServiceCtx = { ...ctx, user: { ...ctx.user, role: "STAFF" } };
  const main = await createWarehouse(ctx, { name: "Main" });
  const other = await createWarehouse(ctx, { name: "Other" });
  const area = await createArea(ctx, { warehouseId: main.id, name: "Shahdara" });
  const crunchy = await createCompany(ctx, {
    warehouseId: main.id,
    name: "Crunchy",
    paymentTermsDays: "15",
    openingBalance: "",
  });
  const golden = await createCompany(ctx, {
    warehouseId: main.id,
    name: "Golden",
    paymentTermsDays: "30",
    openingBalance: "",
  });
  const faraway = await createCompany(ctx, {
    warehouseId: other.id,
    name: "Faraway",
    paymentTermsDays: "7",
    openingBalance: "",
  });
  const product = (companyId: string, code: string, saleRate: string, extra: object = {}) =>
    createProduct(ctx, {
      companyId,
      code,
      name: `Item ${code}`,
      purchaseRate: "100",
      saleRate,
      effectiveFrom: "2026-10-01",
      ...extra,
    });
  const chips = await product(crunchy.id, "CB01", "228", {
    discountType: "AMOUNT_PER_UNIT",
    discountValue: "4",
    slabs: [{ fromDozens: "25", value: "8" }],
  });
  const nimko = await product(golden.id, "GC01", "230");
  const far = await product(faraway.id, "FA01", "100");
  await createGoodsReceipt(ctx, {
    companyId: crunchy.id,
    receivedDate: "2026-10-01",
    lines: [{ productId: chips.id, quantity: "30" }],
  });
  await createGoodsReceipt(ctx, {
    companyId: golden.id,
    receivedDate: "2026-10-01",
    lines: [{ productId: nimko.id, quantity: "10" }],
  });
  const customer = await createCustomer(ctx, {
    name: "Ali Khan",
    type: "RETAILER",
    areaId: area.id,
    creditLimit: "10000",
    openingBalances: { [crunchy.id]: "3000", [golden.id]: "1000" },
  });
  return { ctx, staff, main, other, crunchy, golden, chips, nimko, far, customer };
}

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});

const order = (lines: { productId: string; quantity: string }[], extra: object = {}) => ({
  customerId: t.customer.id,
  orderDate: "2026-10-24",
  deliveryDate: "2026-10-25",
  lines,
  ...extra,
});

describe("booking an order", () => {
  it("prices lines with the company discount, keeps the company on each line, and creates the bill", async () => {
    const result = await createSalesOrder(
      t.staff,
      order([
        { productId: t.chips.id, quantity: "3.5" },
        { productId: t.nimko.id, quantity: "2" },
      ]),
    );
    const full = await getSalesOrder(t.ctx, result.id);
    const chipsLine = full.lines.find((l) => l.productId === t.chips.id)!;
    expect(chipsLine).toMatchObject({ companyId: t.crunchy.id, quantity: 7 });
    expect([chipsLine.discountAmount.toFixed(2), chipsLine.netAmount.toFixed(2)]).toEqual([
      "14.00",
      "784.00",
    ]);
    expect(full.bill!.netAmount.toFixed(2)).toBe("1244.00"); // 784 + 460
    expect(full.bill!.revisions.map((r) => [r.revision, r.reason])).toEqual([[1, "Booked"]]);
    expect(full.bill!.postedAt).toBeNull();
    // Nothing is posted to the journals at booking.
    expect(await t.ctx.db.ledgerEntry.count({ where: { type: "SALES_BILL" } })).toBe(0);
  });

  it("uses the slab once a line reaches it", async () => {
    const r = await createSalesOrder(t.staff, order([{ productId: t.chips.id, quantity: "25" }]));
    const line = (await getSalesOrder(t.ctx, r.id)).lines[0]!;
    expect([line.discountValue.toFixed(2), line.netAmount.toFixed(2)]).toEqual(["8.00", "5500.00"]);
  });

  it("reserves stock: available drops, editing does not double count, cancelling frees it", async () => {
    const before = (await stockPositions(t.ctx.db, t.main.id)).get(t.chips.id)!;
    expect(before).toEqual({ onHand: 60, reserved: 0, available: 60 });
    const r = await createSalesOrder(t.staff, order([{ productId: t.chips.id, quantity: "5" }]));
    expect((await stockPositions(t.ctx.db, t.main.id)).get(t.chips.id)).toEqual({
      onHand: 60,
      reserved: 10,
      available: 50,
    });
    const ctxForEdit = await orderEntryContext(t.ctx, t.customer.id, { excludeOrderId: r.id });
    expect(ctxForEdit.products.find((p) => p.id === t.chips.id)!.available).toBe(60);
    await updateSalesOrder(t.staff, r.id, order([{ productId: t.chips.id, quantity: "6" }]));
    expect((await stockPositions(t.ctx.db, t.main.id)).get(t.chips.id)!.reserved).toBe(12);
    await cancelSalesOrder(t.staff, { id: r.id });
    expect((await stockPositions(t.ctx.db, t.main.id)).get(t.chips.id)!.reserved).toBe(0);
  });

  it("reports products booked beyond available stock (and still books them)", async () => {
    const r = await createSalesOrder(t.staff, order([{ productId: t.nimko.id, quantity: "12" }]));
    expect(r.shortages).toEqual([{ productId: t.nimko.id, name: "Item GC01", short: 4 }]);
  });

  it("refuses products from another warehouse and requires a warehouse for customers without an area", async () => {
    await expect(
      createSalesOrder(t.staff, order([{ productId: t.far.id, quantity: "1" }])),
    ).rejects.toThrow("not stocked in the customer's warehouse");
    const noArea = await createCustomer(t.ctx, { name: "Walk-in", type: "RETAILER" });
    await expect(
      createSalesOrder(t.staff, {
        ...order([{ productId: t.chips.id, quantity: "1" }]),
        customerId: noArea.id,
      }),
    ).rejects.toThrow("Choose the warehouse");
    const ok = await createSalesOrder(t.staff, {
      ...order([{ productId: t.chips.id, quantity: "1" }]),
      customerId: noArea.id,
      warehouseId: t.main.id,
    });
    expect(ok.number).toBeGreaterThan(0);
  });

  it("is idempotent per request id", async () => {
    const requestId = randomUUID();
    const a = await createSalesOrder(
      t.staff,
      order([{ productId: t.chips.id, quantity: "1" }], { requestId }),
    );
    const b = await createSalesOrder(
      t.staff,
      order([{ productId: t.chips.id, quantity: "1" }], { requestId }),
    );
    expect(b.id).toBe(a.id);
    expect(await t.ctx.db.salesOrder.count()).toBe(1);
  });
});

describe("credit limit", () => {
  // Limit 10,000; pending 4,000 (opening balances).
  const big = () => order([{ productId: t.chips.id, quantity: "30" }]); // 30 dz × (228 − 8) = 6,600

  it("staff can book past the limit, but the order waits for the owner", async () => {
    await createSalesOrder(t.staff, order([{ productId: t.nimko.id, quantity: "2" }])); // 460 open
    const r = await createSalesOrder(t.staff, big());
    expect(r.credit.over?.toFixed(2)).toBe("1060.00"); // 4000 + 460 + 6600 − 10000
    expect(r.needsCreditApproval).toBe(true);
    await expect(approveCreditOverride(t.staff, { id: r.id })).rejects.toThrow(ForbiddenError);
    await approveCreditOverride(t.ctx, { id: r.id });
    const approved = await getSalesOrder(t.ctx, r.id);
    expect([approved.needsCreditApproval, approved.creditOverrideById]).toEqual([
      false,
      t.ctx.user.id,
    ]);
  });

  it("the owner must tick 'allow' to book past the limit", async () => {
    await createSalesOrder(t.staff, order([{ productId: t.nimko.id, quantity: "2" }]));
    await expect(createSalesOrder(t.ctx, big())).rejects.toThrow("past their credit limit");
    const r = await createSalesOrder(t.ctx, { ...big(), allowOverCredit: "on" });
    expect([r.needsCreditApproval, (await getSalesOrder(t.ctx, r.id)).creditOverrideById]).toEqual([
      false,
      t.ctx.user.id,
    ]);
  });
});

describe("editing and bill revisions", () => {
  it("each edit adds a bill revision; dispatched orders cannot be edited or cancelled", async () => {
    const r = await createSalesOrder(t.staff, order([{ productId: t.chips.id, quantity: "2" }]));
    await updateSalesOrder(
      t.staff,
      r.id,
      order([
        { productId: t.chips.id, quantity: "3" },
        { productId: t.nimko.id, quantity: "1" },
      ]),
    );
    const full = await getSalesOrder(t.ctx, r.id);
    expect(full.bill!.revisions.map((v) => [v.revision, v.netAmount.toFixed(2)])).toEqual([
      [2, "902.00"], // 3 × 224 + 230
      [1, "448.00"],
    ]);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: r.id, action: "UPDATE" },
    });
    expect(audit.oldValue).toMatchObject({ lines: [{ quantity: 4 }] });

    await prisma.salesOrder.update({ where: { id: r.id }, data: { status: "DISPATCHED" } });
    await expect(
      updateSalesOrder(t.staff, r.id, order([{ productId: t.chips.id, quantity: "1" }])),
    ).rejects.toThrow("day-end");
    await expect(cancelSalesOrder(t.staff, { id: r.id })).rejects.toThrow("Only booked or planned");
  });
});

describe("bill view", () => {
  it("shows previous pending, this bill and total due, overall and per company", async () => {
    const r = await createSalesOrder(
      t.staff,
      order([
        { productId: t.chips.id, quantity: "2" },
        { productId: t.nimko.id, quantity: "1" },
      ]),
    );
    const view = await getBillView(t.ctx, r.id);
    expect([
      view.previous.toFixed(2),
      view.bill.netAmount.toFixed(2),
      view.totalDue.toFixed(2),
    ]).toEqual(["4000.00", "678.00", "4678.00"]);
    expect(
      view.sections.map((s) => [
        s.companyName,
        s.previous.toFixed(2),
        s.thisBill.toFixed(2),
        s.totalDue.toFixed(2),
      ]),
    ).toEqual([
      ["Crunchy", "3000.00", "448.00", "3448.00"],
      ["Golden", "1000.00", "230.00", "1230.00"],
    ]);
    expect(view.lines.map((l) => l.code).sort()).toEqual(["CB01", "GC01"]);
  });
});

describe("order entry context", () => {
  it("gives pending per company, open orders, products with stock, and the last order", async () => {
    await createSalesOrder(t.staff, order([{ productId: t.chips.id, quantity: "2" }]));
    const c = await orderEntryContext(t.ctx, t.customer.id);
    expect([c.pending, c.openOrders, c.customer.creditLimit]).toEqual([
      "4000.00",
      "448.00",
      "10000.00",
    ]);
    expect(c.pendingByCompany.map((p) => [p.companyName, p.amount]).sort()).toEqual([
      ["Crunchy", "3000.00"],
      ["Golden", "1000.00"],
    ]);
    expect(c.products.map((p) => p.code)).toEqual(["CB01", "GC01"]);
    expect(c.products[0]).toMatchObject({ available: 56, tiers: [{ minQuantity: 50 }] });
    expect(c.lastOrder?.lines).toEqual([{ productId: t.chips.id, quantity: 4 }]);
  });
});
