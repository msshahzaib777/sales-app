import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "../../auth/permissions";
import { prisma } from "../../db/client";
import { createTenantDb } from "../../db/tenant";
import { createArea } from "../master/areas";
import { createBike } from "../master/bikes";
import type { ServiceCtx } from "../master/common";
import { createCompany } from "../master/companies";
import { createCustomer } from "../master/customers";
import { createProduct } from "../master/products";
import { createStaff } from "../master/staff";
import { createWarehouse } from "../master/warehouses";
import { returnDamagedStock } from "../inventory";
import { clearCheque } from "../payments/customer-payments";
import { createGoodsReceipt } from "../purchasing/goods-receipts";
import { getBillView } from "../sales/bills";
import { createSalesOrder } from "../sales/orders";
import { customerPending, stockPositions } from "../sales/positions";
import { getDayEndEntry, nextOrderToReconcile, saveDayEnd, undoDayEnd } from "./day-end";
import {
  addOrdersToTrip,
  bookedOrdersFor,
  cancelTrip,
  createTrip,
  dispatchTrip,
  getTrip,
  removeOrderFromTrip,
  setTripDriver,
} from "./trips";

const DAY = "2026-10-25";

async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({ data: { name: `D ${suffix}`, slug: `d-${suffix}` } });
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `d-${suffix}@t.local`,
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
  const wh = await createWarehouse(ctx, { name: "Main" });
  const other = await createWarehouse(ctx, { name: "Other" });
  const area = await createArea(ctx, { warehouseId: wh.id, name: "Shahdara" });
  const company = (name: string, warehouseId = wh.id) =>
    createCompany(ctx, { warehouseId, name, paymentTermsDays: "15", openingBalance: "" });
  const crunchy = await company("Crunchy");
  const golden = await company("Golden");
  const faraway = await company("Faraway", other.id);
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
  const chips = await product(crunchy.id, "CB01", "200", {
    discountType: "AMOUNT_PER_UNIT",
    discountValue: "4",
  });
  const nimko = await product(golden.id, "GC01", "150");
  const far = await product(faraway.id, "FA01", "100");
  for (const [companyId, productId] of [
    [crunchy.id, chips.id],
    [golden.id, nimko.id],
    [faraway.id, far.id],
  ] as const)
    await createGoodsReceipt(ctx, {
      companyId,
      receivedDate: "2026-10-01",
      lines: [{ productId, quantity: "50" }],
    });
  const driver = await createStaff(ctx, {
    name: "Aslam",
    role: "DRIVER",
    monthlySalary: "30000",
  });
  const bike = await createBike(ctx, {
    name: "Bike 1",
    warehouseId: wh.id,
    capacity: "90",
    driverId: driver.id,
  });
  const customer = (name: string, extra: object = {}) =>
    createCustomer(ctx, { name, type: "RETAILER", areaId: area.id, ...extra });
  const ali = await customer("Ali", {
    openingBalances: { [crunchy.id]: "3000", [golden.id]: "1000" },
  });
  const bilal = await customer("Bilal");
  return {
    ctx,
    staff,
    wh,
    other,
    crunchy,
    golden,
    chips,
    nimko,
    far,
    driver,
    bike,
    ali,
    bilal,
  };
}

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});

const book = (customerId: string, lines: [string, string][], extra: object = {}) =>
  createSalesOrder(t.staff, {
    customerId,
    orderDate: "2026-10-24",
    deliveryDate: DAY,
    lines: lines.map(([productId, quantity]) => ({ productId, quantity })),
    ...extra,
  });

const trip = (orderIds: string[], extra: object = {}) =>
  createTrip(t.staff, {
    tripDate: DAY,
    bikeId: t.bike.id,
    driverId: t.driver.id,
    orderIds,
    ...extra,
  });

const onHand = async (productId: string) =>
  (await stockPositions(t.ctx.db, t.wh.id, [productId])).get(productId)!.onHand;

const sum = (rows: { debit: unknown; credit: unknown }[]) =>
  rows.reduce((s, r) => s + Number(r.debit) - Number(r.credit), 0);

describe("planning a trip", () => {
  it("puts booked orders of the day on a bike, and takes them off again", async () => {
    const a = await book(t.ali.id, [[t.chips.id, "10"]]);
    const b = await book(t.bilal.id, [[t.nimko.id, "2"]]);
    expect(
      (await bookedOrdersFor(t.staff, new Date(`${DAY}T00:00:00Z`))).map((o) => o.number),
    ).toEqual([a.number, b.number]);
    const tr = await trip([a.id]);
    expect(tr.warehouseId).toBe(t.wh.id);
    expect((await t.ctx.db.salesOrder.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      "PLANNED",
    );
    await addOrdersToTrip(t.staff, { tripId: tr.id, orderIds: [b.id] });
    const view = await getTrip(t.staff, tr.id);
    expect(view.orders).toHaveLength(2);
    expect(view.totals.load).toBe(24);
    expect(view.load.map((p) => [p.code, p.quantity])).toEqual([
      ["CB01", 20],
      ["GC01", 4],
    ]);

    // The same order cannot go on two trips.
    await expect(trip([a.id])).rejects.toThrow(/not waiting for delivery/);
    await removeOrderFromTrip(t.staff, { tripId: tr.id, orderId: a.id });
    expect((await t.ctx.db.salesOrder.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      "BOOKED",
    );
    await cancelTrip(t.staff, { id: tr.id });
    expect(
      (await t.ctx.db.salesOrder.findUniqueOrThrow({ where: { id: b.id } })).tripId,
    ).toBeNull();
    expect((await t.ctx.db.deliveryTrip.findUniqueOrThrow({ where: { id: tr.id } })).status).toBe(
      "CANCELLED",
    );
  });

  it("refuses orders of another day or another warehouse, and retries return the same trip", async () => {
    const later = await book(t.ali.id, [[t.chips.id, "1"]], { deliveryDate: "2026-10-26" });
    await expect(trip([later.id])).rejects.toThrow(/another delivery date/);
    const faisal = await createCustomer(t.ctx, { name: "Faisal", type: "RETAILER" });
    const far = await book(faisal.id, [[t.far.id, "1"]], { warehouseId: t.other.id });
    await expect(trip([far.id])).rejects.toThrow(/another warehouse/);
    const requestId = randomUUID();
    const a = await book(t.bilal.id, [[t.chips.id, "1"]]);
    const first = await trip([a.id], { requestId });
    const again = await trip([a.id], { requestId });
    expect(again.id).toBe(first.id);
  });
});

describe("dispatch", () => {
  it("takes stock out, posts each bill per company and freezes the previous pending", async () => {
    const a = await book(t.ali.id, [
      [t.chips.id, "10"],
      [t.nimko.id, "2"],
    ]);
    const tr = await trip([a.id]);
    await dispatchTrip(t.staff, { id: tr.id });

    expect(await onHand(t.chips.id)).toBe(80);
    expect(await onHand(t.nimko.id)).toBe(96);
    const entries = await t.ctx.db.ledgerEntry.findMany({
      where: { partyType: "CUSTOMER", customerId: t.ali.id, type: "SALES_BILL" },
    });
    expect(entries.map((e) => [e.companyId, e.debit.toFixed(2)]).sort()).toEqual(
      [
        [t.crunchy.id, "1960.00"],
        [t.golden.id, "300.00"],
      ].sort(),
    );
    const order = await t.ctx.db.salesOrder.findUniqueOrThrow({
      where: { id: a.id },
      include: { bill: true },
    });
    expect(order.status).toBe("DISPATCHED");
    expect(order.bill!.postedAt).not.toBeNull();
    expect(order.bill!.previousBalance.toFixed(2)).toBe("4000.00");

    const view = await getBillView(t.staff, a.id);
    expect(view.bill.posted).toBe(true);
    expect(view.previous.toFixed(2)).toBe("4000.00");
    expect(view.totalDue.toFixed(2)).toBe("6260.00");
    expect(
      view.sections.map((s) => [s.companyName, s.previous.toFixed(2), s.totalDue.toFixed(2)]),
    ).toEqual([
      ["Crunchy", "3000.00", "4960.00"],
      ["Golden", "1000.00", "1300.00"],
    ]);

    await expect(dispatchTrip(t.staff, { id: tr.id })).rejects.toThrow(/already left/);
    await expect(removeOrderFromTrip(t.staff, { tripId: tr.id, orderId: a.id })).rejects.toThrow(
      /already left/,
    );
  });

  it("refuses to dispatch when stock is short or an order waits for credit approval", async () => {
    const big = await book(t.ali.id, [[t.chips.id, "60"]]);
    const tr = await trip([big.id]);
    await expect(dispatchTrip(t.staff, { id: tr.id })).rejects.toThrow(
      /Not enough stock.*Item CB01/,
    );
    expect(await onHand(t.chips.id)).toBe(100);

    await t.ctx.db.customer.update({ where: { id: t.bilal.id }, data: { creditLimit: 100 } });
    const over = await book(t.bilal.id, [[t.nimko.id, "2"]]);
    const tr2 = await trip([over.id]);
    await expect(dispatchTrip(t.staff, { id: tr2.id })).rejects.toThrow(/waits for the owner/);
  });
});

describe("day-end entry", () => {
  async function dispatched() {
    const a = await book(t.ali.id, [
      [t.chips.id, "10"],
      [t.nimko.id, "2"],
    ]);
    const b = await book(t.bilal.id, [[t.nimko.id, "3"]]);
    const tr = await trip([a.id, b.id]);
    await dispatchTrip(t.staff, { id: tr.id });
    return { a, b, tr };
  }

  it("puts returns back, logs damage as a claim, revises the bill and splits the cash by company", async () => {
    const { a, tr } = await dispatched();
    const result = await saveDayEnd(t.staff, {
      requestId: randomUUID(),
      orderId: a.id,
      lines: [
        { productId: t.chips.id, returned: "2", damaged: "1" },
        { productId: t.nimko.id, returned: "", damaged: "" },
      ],
      cash: "1000",
    });
    expect(result.status).toBe("PARTIALLY_DELIVERED");

    // Stock: 100 − 20 dispatched + 4 returned; 2 half dozens in damaged stock.
    expect(await onHand(t.chips.id)).toBe(84);
    const damaged = await t.ctx.db.stockMovement.aggregate({
      where: { productId: t.chips.id, bucket: "DAMAGED" },
      _sum: { quantity: true },
    });
    expect(damaged._sum.quantity).toBe(2);

    // Claim against Crunchy at purchase cost: 1 dozen × 100.
    const claim = await t.ctx.db.companyClaim.findFirstOrThrow({ where: { salesOrderId: a.id } });
    expect([claim.type, claim.quantity, claim.amount.toFixed(2)]).toEqual([
      "DELIVERY_DAMAGE",
      2,
      "100.00",
    ]);
    const companyLedger = await t.ctx.db.ledgerEntry.findMany({
      where: { partyType: "COMPANY", companyId: t.crunchy.id, type: "COMPANY_CLAIM" },
    });
    expect(companyLedger[0]!.debit.toFixed(2)).toBe("100.00");

    // Bill: 7 dozen chips kept (7 × 196) + nimko 300.
    const view = await getBillView(t.staff, a.id);
    expect(view.bill.revision).toBe(2);
    expect(view.bill.netAmount.toFixed(2)).toBe("1672.00");
    expect(view.lines.find((l) => l.productId === t.chips.id)!.quantity).toBe(14);
    expect(view.sections[0]!.previous.toFixed(2)).toBe("3000.00");
    const revision = await t.ctx.db.ledgerEntry.findFirstOrThrow({
      where: { customerId: t.ali.id, type: "BILL_REVISION" },
    });
    expect([revision.companyId, revision.credit.toFixed(2)]).toEqual([t.crunchy.id, "588.00"]);

    // Cash 1000 pays the oldest debt first: the opening balances (Crunchy 3000, Golden 1000).
    const payment = await t.ctx.db.customerPayment.findFirstOrThrow({
      where: { salesOrderId: a.id },
      include: { allocations: true },
    });
    expect([payment.method, payment.collectedVia, payment.amount.toFixed(2)]).toEqual([
      "CASH",
      "DELIVERY",
      "1000.00",
    ]);
    const credits = await t.ctx.db.ledgerEntry.findMany({
      where: { customerId: t.ali.id, type: "CUSTOMER_PAYMENT" },
    });
    expect(Object.fromEntries(credits.map((c) => [c.companyId, c.credit.toFixed(2)]))).toEqual({
      [t.crunchy.id]: "750.00",
      [t.golden.id]: "250.00",
    });
    expect(payment.allocations).toHaveLength(0);

    // Pending now: 4000 + 1672 − 1000.
    expect((await customerPending(t.ctx.db, t.ali.id)).total.toFixed(2)).toBe("4672.00");
    const ledger = await t.ctx.db.ledgerEntry.findMany({ where: { customerId: t.ali.id } });
    expect(sum(ledger)).toBe(4672);

    // The trip stays open until the other order is entered.
    expect((await getTrip(t.staff, tr.id)).status).toBe("DISPATCHED");
    expect(await nextOrderToReconcile(t.staff, tr.id)).not.toBe(a.id);
  });

  it("handles a refused order, a cheque, and closes the trip; nothing posts twice", async () => {
    const { a, b, tr } = await dispatched();
    await saveDayEnd(t.staff, { orderId: a.id, lines: [], cash: "500" });
    const requestId = randomUUID();
    const refused = {
      requestId,
      orderId: b.id,
      lines: [{ productId: t.nimko.id, returned: "3", damaged: "0" }],
      chequeAmount: "250",
      chequeNo: "001122",
      bankName: "HBL",
      chequeDate: DAY,
    };
    expect((await saveDayEnd(t.staff, refused)).status).toBe("RETURNED");
    expect((await saveDayEnd(t.staff, refused)).repeated).toBe(true);
    await expect(saveDayEnd(t.staff, { ...refused, requestId: randomUUID() })).rejects.toThrow(
      /already entered/,
    );

    const bill = await getBillView(t.staff, b.id);
    expect(bill.bill.netAmount.toFixed(2)).toBe("0.00");
    expect(bill.lines).toHaveLength(0);
    // Bilal owed nothing: the cheque is an advance with the order's company.
    expect((await customerPending(t.ctx.db, t.bilal.id)).total.toFixed(2)).toBe("-250.00");
    const cheque = await t.ctx.db.cheque.findFirstOrThrow({});
    expect([cheque.direction, cheque.status, cheque.chequeNo]).toEqual([
      "RECEIVED",
      "PENDING",
      "001122",
    ]);
    expect(await onHand(t.nimko.id)).toBe(96);

    const view = await getTrip(t.staff, tr.id);
    expect(view.status).toBe("RECONCILED");
    expect(view.totals.cash.toFixed(2)).toBe("500.00");
    expect(view.totals.cheque.toFixed(2)).toBe("250.00");
    expect(await nextOrderToReconcile(t.staff, tr.id)).toBeNull();

    const audit = await t.ctx.db.auditLog.count({
      where: { entityType: "SalesOrder", action: "POST" },
    });
    expect(audit).toBe(2);
  });

  it("checks quantities and needs a dispatched order", async () => {
    const { a } = await dispatched();
    await expect(
      saveDayEnd(t.staff, {
        orderId: a.id,
        lines: [{ productId: t.chips.id, returned: "8", damaged: "3" }],
      }),
    ).rejects.toThrow(/more than the quantity sent/);
    await expect(
      saveDayEnd(t.staff, { orderId: a.id, lines: [], chequeAmount: "10" }),
    ).rejects.toThrow();
    const booked = await book(t.bilal.id, [[t.chips.id, "1"]]);
    await expect(saveDayEnd(t.staff, { orderId: booked.id, lines: [] })).rejects.toThrow(
      /not been dispatched/,
    );
    const entry = await getDayEndEntry(t.staff, a.id);
    expect(entry.lines).toHaveLength(2);
    expect(entry.trip.number).toBeGreaterThan(0);
  });
});

describe("undoing a day-end entry", () => {
  async function entered() {
    const a = await book(t.ali.id, [
      [t.chips.id, "10"],
      [t.nimko.id, "2"],
    ]);
    const tr = await trip([a.id]);
    await dispatchTrip(t.staff, { id: tr.id });
    // Entered wrongly: 2 dz chips returned, 1 dz damaged, 1000 cash.
    await saveDayEnd(t.staff, {
      orderId: a.id,
      lines: [{ productId: t.chips.id, returned: "2", damaged: "1" }],
      cash: "1000",
    });
    return { a, tr };
  }
  const damagedStock = async (productId: string) =>
    (
      await t.ctx.db.stockMovement.aggregate({
        where: { productId, bucket: "DAMAGED" },
        _sum: { quantity: true },
      })
    )._sum.quantity ?? 0;

  it("puts everything back as dispatched, by reversal, and the order can be entered again", async () => {
    const { a, tr } = await entered();
    expect((await getTrip(t.staff, tr.id)).status).toBe("RECONCILED");
    await expect(undoDayEnd(t.staff, { id: a.id, reason: "wrong lines" })).rejects.toThrow(
      ForbiddenError,
    );
    await undoDayEnd(t.ctx, { id: a.id, reason: "typed the wrong order" });

    // Stock as dispatched: 100 − 20 chips, nothing damaged.
    expect(await onHand(t.chips.id)).toBe(80);
    expect(await damagedStock(t.chips.id)).toBe(0);
    // Claim cancelled, company ledger back to just the receipt.
    const claim = await t.ctx.db.companyClaim.findFirstOrThrow({ where: { salesOrderId: a.id } });
    expect(claim.status).toBe("REVERSED");
    const crunchyLedger = await t.ctx.db.ledgerEntry.findMany({
      where: { partyType: "COMPANY", companyId: t.crunchy.id },
    });
    expect(sum(crunchyLedger)).toBe(-5000); // the 50 dz receipt at 100
    // Bill back to 2260 as a new revision; customer owes 4000 + 2260 again; cash reversed.
    const view = await getBillView(t.staff, a.id);
    expect([view.bill.netAmount.toFixed(2), view.bill.revision]).toEqual(["2260.00", 3]);
    expect((await customerPending(t.ctx.db, t.ali.id)).total.toFixed(2)).toBe("6260.00");
    const payment = await t.ctx.db.customerPayment.findFirstOrThrow({
      where: { salesOrderId: a.id },
    });
    expect(payment.status).toBe("REVERSED");
    const order = await t.ctx.db.salesOrder.findUniqueOrThrow({
      where: { id: a.id },
      include: { lines: true },
    });
    expect([order.status, order.reconciledAt]).toEqual(["DISPATCHED", null]);
    expect(order.lines.every((l) => l.returnedQuantity === 0 && l.damagedQuantity === 0)).toBe(
      true,
    );
    expect((await getTrip(t.staff, tr.id)).status).toBe("DISPATCHED");
    await expect(undoDayEnd(t.ctx, { id: a.id, reason: "again" })).rejects.toThrow(
      /not been entered/,
    );

    // Entered again, correctly: everything delivered, 2260 paid.
    await saveDayEnd(t.staff, { orderId: a.id, lines: [], cash: "2260" });
    expect((await customerPending(t.ctx.db, t.ali.id)).total.toFixed(2)).toBe("4000.00");
    expect((await getBillView(t.staff, a.id)).bill.revision).toBe(3);
    expect((await getTrip(t.staff, tr.id)).status).toBe("RECONCILED");
    const ledger = await t.ctx.db.ledgerEntry.findMany({ where: { customerId: t.ali.id } });
    expect(sum(ledger)).toBe(4000);
    expect(
      await t.ctx.db.auditLog.count({ where: { entityType: "SalesOrder", action: "REVERSE" } }),
    ).toBe(1);
  });

  it("refuses when the damaged stock was sent back, a claim was deducted, or a cheque cleared", async () => {
    const { a } = await entered();
    await returnDamagedStock(t.ctx, { productId: t.chips.id, quantity: "1", returnDate: DAY });
    await expect(undoDayEnd(t.ctx, { id: a.id, reason: "late fix" })).rejects.toThrow(
      /already been sent back/,
    );

    const second = await entered();
    void second;
    await createGoodsReceipt(t.ctx, {
      companyId: t.crunchy.id,
      receivedDate: DAY,
      lines: [{ productId: t.chips.id, quantity: "5" }],
    });
    const withClaim = await t.ctx.db.companyClaim.findFirstOrThrow({
      where: { salesOrderId: second.a.id },
    });
    expect(withClaim.status).toBe("APPLIED");
    await expect(undoDayEnd(t.ctx, { id: second.a.id, reason: "late fix" })).rejects.toThrow(
      /deducted on company bill/,
    );

    const c = await book(t.bilal.id, [[t.nimko.id, "1"]]);
    const tr = await trip([c.id]);
    await dispatchTrip(t.staff, { id: tr.id });
    await saveDayEnd(t.staff, {
      orderId: c.id,
      lines: [],
      chequeAmount: "150",
      chequeNo: "77",
      bankName: "MCB",
      chequeDate: DAY,
    });
    const cheque = await t.ctx.db.customerPayment.findFirstOrThrow({
      where: { salesOrderId: c.id },
    });
    await clearCheque(t.ctx, { id: cheque.id });
    await expect(undoDayEnd(t.ctx, { id: c.id, reason: "late fix" })).rejects.toThrow(/cleared/);
  });
});

describe("driver", () => {
  it("is optional when planning and can be set or changed until day-end is done", async () => {
    const a = await book(t.ali.id, [[t.chips.id, "1"]]);
    const tr = await trip([a.id], { driverId: "" });
    expect(tr.driverId).toBeNull();
    expect((await getTrip(t.staff, tr.id)).driver).toBeNull();

    // Dispatched without a driver, set afterwards, then changed and cleared again.
    await dispatchTrip(t.staff, { id: tr.id });
    await setTripDriver(t.staff, { tripId: tr.id, driverId: t.driver.id });
    expect((await getTrip(t.staff, tr.id)).driver?.name).toBe("Aslam");
    await setTripDriver(t.staff, { tripId: tr.id, driverId: "" });
    expect((await getTrip(t.staff, tr.id)).driverId).toBeNull();
    await setTripDriver(t.staff, { tripId: tr.id, driverId: t.driver.id });
    expect(
      await t.ctx.db.auditLog.count({
        where: { entityType: "DeliveryTrip", entityId: tr.id, action: "UPDATE" },
      }),
    ).toBe(3);

    await saveDayEnd(t.staff, { orderId: a.id, lines: [] });
    await expect(setTripDriver(t.staff, { tripId: tr.id, driverId: "" })).rejects.toThrow(
      /day-end is done/,
    );
  });

  it("must be an active staff member when given", async () => {
    const a = await book(t.ali.id, [[t.chips.id, "1"]]);
    await expect(trip([a.id], { driverId: "missing" })).rejects.toThrow(/active driver/);
  });
});
