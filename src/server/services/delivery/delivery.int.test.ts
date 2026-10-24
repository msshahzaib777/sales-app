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
import { bounceCheque, clearCheque } from "../payments/customer-payments";
import { settleClaim } from "../purchasing/claims";
import { getDashboard } from "../dashboard";
import { createCustomerPayment } from "../payments/customer-payments";
import { businessAnalysis } from "../reports/analysis";
import { dailyReport } from "../reports/daily";
import { damageReport } from "../reports/damage";
import { createGoodsReceipt } from "../purchasing/goods-receipts";
import { getBillView } from "../sales/bills";
import { businessToday, toDateInput } from "@/lib/dates";
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
    expect(view.totals.load).toBe(144);
    expect(view.load.map((p) => [p.code, p.quantity])).toEqual([
      ["CB01", 120],
      ["GC01", 24],
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

    expect(await onHand(t.chips.id)).toBe(480);
    expect(await onHand(t.nimko.id)).toBe(576);
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
    expect(await onHand(t.chips.id)).toBe(600);

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
        { productId: t.chips.id, returned: "24pk", damaged: "12pk" },
        { productId: t.nimko.id, returned: "", damaged: "" },
      ],
      cash: "1000",
    });
    expect(result.status).toBe("PARTIALLY_DELIVERED");

    // Stock (packets): 600 − 120 dispatched + 24 returned; 12 in damaged stock.
    expect(await onHand(t.chips.id)).toBe(504);
    const damaged = await t.ctx.db.stockMovement.aggregate({
      where: { productId: t.chips.id, bucket: "DAMAGED" },
      _sum: { quantity: true },
    });
    expect(damaged._sum.quantity).toBe(12);

    // Claim against Crunchy at purchase cost: 1 dozen × 100, waiting to be settled; no money yet.
    const claim = await t.ctx.db.companyClaim.findFirstOrThrow({ where: { salesOrderId: a.id } });
    expect([claim.type, claim.status, claim.quantity, claim.amount.toFixed(2)]).toEqual([
      "DELIVERY_DAMAGE",
      "AWAITING",
      12,
      "100.00",
    ]);
    const claimCredits = () =>
      t.ctx.db.ledgerEntry.findMany({
        where: { partyType: "COMPANY", companyId: t.crunchy.id, type: "COMPANY_CLAIM" },
      });
    expect(await claimCredits()).toHaveLength(0);

    // Bill: 7 dozen chips kept (7 × 196) + nimko 300.
    const view = await getBillView(t.staff, a.id);
    expect(view.bill.revision).toBe(2);
    expect(view.bill.netAmount.toFixed(2)).toBe("1672.00");
    expect(view.lines.find((l) => l.productId === t.chips.id)!.quantity).toBe(84);
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
      lines: [{ productId: t.nimko.id, returned: "36pk", damaged: "0pk" }],
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
    expect(await onHand(t.nimko.id)).toBe(576);

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
        lines: [{ productId: t.chips.id, returned: "96pk", damaged: "36pk" }],
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
      lines: [{ productId: t.chips.id, returned: "24pk", damaged: "12pk" }],
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

    // Stock as dispatched: 100 − 20 dozen chips, nothing damaged.
    expect(await onHand(t.chips.id)).toBe(480);
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
    await returnDamagedStock(t.ctx, { productId: t.chips.id, quantity: "12pk", returnDate: DAY });
    await expect(undoDayEnd(t.ctx, { id: a.id, reason: "late fix" })).rejects.toThrow(
      /already been sent back/,
    );

    const second = await entered();
    const secondClaim = await t.ctx.db.companyClaim.findFirstOrThrow({
      where: { salesOrderId: second.a.id },
    });
    await settleClaim(t.ctx, { id: secondClaim.id, decision: "ACCEPT" });
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

describe("settling a day-end damage claim", () => {
  const damaged = async () => {
    const a = await book(t.ali.id, [[t.chips.id, "2"]]);
    const tr = await createTrip(t.staff, { tripDate: DAY, bikeId: t.bike.id, orderIds: [a.id] });
    await dispatchTrip(t.staff, { id: tr.id });
    await saveDayEnd(t.staff, {
      orderId: a.id,
      lines: [{ productId: t.chips.id, returned: "", damaged: "12pk" }],
    });
    return t.ctx.db.companyClaim.findFirstOrThrow({ where: { salesOrderId: a.id } });
  };
  const credits = async () =>
    (
      await t.ctx.db.ledgerEntry.findMany({
        where: { partyType: "COMPANY", type: "COMPANY_CLAIM" },
      })
    ).map((e) => e.debit.toFixed(2));

  it("accepts a smaller amount: only that is credited, and deducted on the next bill", async () => {
    const claim = await damaged();
    await expect(
      settleClaim(t.ctx, { id: claim.id, decision: "ACCEPT_LESS", amount: "150" }),
    ).rejects.toThrow(/more than the 100.00 claimed/);
    await expect(settleClaim(t.staff, { id: claim.id, decision: "ACCEPT" })).rejects.toThrow(
      ForbiddenError,
    );
    const settled = await settleClaim(t.ctx, {
      id: claim.id,
      decision: "ACCEPT_LESS",
      amount: "80",
      note: "Company paid for 80",
    });
    expect([settled.status, settled.amount.toFixed(2), settled.claimedAmount?.toFixed(2)]).toEqual([
      "PENDING",
      "80.00",
      "100.00",
    ]);
    expect(await credits()).toEqual(["80.00"]);
    await expect(settleClaim(t.ctx, { id: claim.id, decision: "REJECT" })).rejects.toThrow(
      /already settled/,
    );
    const receipt = await createGoodsReceipt(t.ctx, {
      companyId: t.crunchy.id,
      receivedDate: DAY,
      lines: [{ productId: t.chips.id, quantity: "5" }],
    });
    expect(receipt.companyBill.claimDeduction.toFixed(2)).toBe("80.00");
  });

  it("a rejected claim moves no money and is never deducted", async () => {
    const claim = await damaged();
    const rejected = await settleClaim(t.ctx, { id: claim.id, decision: "REJECT" });
    expect(rejected.status).toBe("REJECTED");
    expect(await credits()).toEqual([]);
    const receipt = await createGoodsReceipt(t.ctx, {
      companyId: t.crunchy.id,
      receivedDate: DAY,
      lines: [{ productId: t.chips.id, quantity: "5" }],
    });
    expect(receipt.companyBill.claimDeduction.toFixed(2)).toBe("0.00");
    // The damaged stock stays damaged either way.
    expect(
      (
        await t.ctx.db.stockMovement.aggregate({
          where: { productId: t.chips.id, bucket: "DAMAGED" },
          _sum: { quantity: true },
        })
      )._sum.quantity,
    ).toBe(12);
  });
});

describe("damage report", () => {
  it("lists day-end damage by trip date with filters; value only for roles that see cost", async () => {
    const a = await book(t.ali.id, [[t.chips.id, "2"]]);
    const tr = await trip([a.id]);
    await dispatchTrip(t.staff, { id: tr.id });
    await saveDayEnd(t.staff, {
      orderId: a.id,
      lines: [{ productId: t.chips.id, returned: "", damaged: "5pk" }],
    });
    const range = { from: new Date(`${DAY}T00:00:00.000Z`), to: new Date(`${DAY}T00:00:00.000Z`) };

    const owner = await damageReport(t.ctx, range);
    expect(owner.rows.map((r) => [r.driverName, r.productCode, r.quantity])).toEqual([
      ["Aslam", "CB01", 5],
    ]);
    expect([owner.totals.claimed.toFixed(2), owner.rows[0]!.claim?.status]).toEqual([
      "41.67", // 5 packets at 100 a dozen
      "AWAITING",
    ]);

    const staff = await damageReport(t.staff, range);
    expect([staff.showValue, staff.rows[0]!.claim, staff.totals.claimed.toFixed(2)]).toEqual([
      false,
      null,
      "0.00",
    ]);

    expect((await damageReport(t.ctx, { ...range, productId: t.nimko.id })).rows).toHaveLength(0);
    expect((await damageReport(t.ctx, { ...range, driverId: t.driver.id })).rows).toHaveLength(1);
    expect((await damageReport(t.ctx, { ...range, tripId: tr.id })).rows).toHaveLength(1);
    const before = new Date("2026-10-01T00:00:00.000Z");
    expect((await damageReport(t.ctx, { from: before, to: before })).rows).toHaveLength(0);
  });
});

describe("dashboard", () => {
  it("shows today's work, customers over their limit and low stock; money only to payment roles", async () => {
    const today = businessToday();
    const day = (offset: number) => toDateInput(new Date(today.getTime() + offset * 86_400_000));
    // Tomorrow: one order booked, not on a trip yet.
    await createSalesOrder(t.staff, {
      customerId: t.bilal.id,
      orderDate: day(0),
      deliveryDate: day(1),
      lines: [{ productId: t.nimko.id, quantity: "1" }],
    });
    // One trip out, its day-end not entered.
    const a = await book(t.bilal.id, [[t.chips.id, "2"]]);
    const tr = await trip([a.id]);
    await dispatchTrip(t.staff, { id: tr.id });
    // Ali owes 4000 (opening) − 500 paid today, with a 2000 limit.
    await prisma.customer.update({ where: { id: t.ali.id }, data: { creditLimit: 2000 } });
    await createCustomerPayment(t.ctx, {
      customerId: t.ali.id,
      paymentDate: day(0),
      method: "CASH",
      amount: "500",
    });
    // Chips: 50 dz received − 2 dispatched, minimum 60 dz.
    await prisma.product.update({ where: { id: t.chips.id }, data: { minStockLevel: 720 } });

    const d = await getDashboard(t.ctx);
    // Every order for tomorrow that isn't cancelled (the trip below may fall on tomorrow too).
    const forTomorrow = await t.ctx.db.salesOrder.count({
      where: { deliveryDate: new Date(`${day(1)}T00:00:00.000Z`), status: { not: "CANCELLED" } },
    });
    expect([d.work.ordersTomorrow, d.work.notOnTripTomorrow]).toEqual([forTomorrow, 1]);
    expect(d.work.tripsOut.map((x) => [x.number, x.ordersPending])).toEqual([[tr.number, 1]]);
    expect(d.work.dayEndPending).toBe(1);
    expect(d.overLimit.map((c) => [c.name, c.over.toFixed(2)])).toEqual([["Ali", "1500.00"]]);
    expect(d.lowStock.rows.map((p) => [p.code, p.available])).toEqual([["CB01", 576]]);
    expect([d.money!.collected.cash.amount.toFixed(2), d.money!.collected.cash.count]).toEqual([
      "500.00",
      1,
    ]);
    // The three goods receipts of 1 Oct, due after 15 days, are unpaid.
    expect(d.money!.companyBills.overdue.rows).toHaveLength(3);

    // Yesterday: its "next day" is today (the trip above may fall on today), nothing collected.
    // Trips out are always as now.
    const yesterday = await getDashboard(t.ctx, { date: new Date(`${day(-1)}T00:00:00.000Z`) });
    const forToday = await t.ctx.db.salesOrder.count({
      where: { deliveryDate: new Date(`${day(0)}T00:00:00.000Z`), status: { not: "CANCELLED" } },
    });
    expect([yesterday.isToday, yesterday.work.ordersTomorrow]).toEqual([false, forToday]);
    expect(yesterday.money!.collectedTotal.toFixed(2)).toBe("0.00");
    expect(yesterday.work.tripsOut).toHaveLength(1);
    expect(d.isToday).toBe(true);

    const staffView = await getDashboard(t.staff);
    expect(staffView.money).toBeNull();
    expect(staffView.overLimit).toHaveLength(1);
  });
});

describe("a bounced day-end cheque", () => {
  it("puts back exactly the cheque's amount, on every screen that shows the balance", async () => {
    const a = await book(t.bilal.id, [[t.chips.id, "2"]]);
    const tr = await trip([a.id]);
    await dispatchTrip(t.staff, { id: tr.id });
    const owed = async () => (await customerPending(t.ctx.db, t.bilal.id)).total.toFixed(2);
    expect(await owed()).toBe("392.00"); // the bill
    await saveDayEnd(t.staff, {
      orderId: a.id,
      lines: [],
      chequeAmount: "300",
      chequeNo: "11",
      bankName: "HBL",
      chequeDate: DAY,
    });
    expect(await owed()).toBe("92.00");
    const p = await t.ctx.db.customerPayment.findFirstOrThrow({ where: { salesOrderId: a.id } });
    await bounceCheque(t.ctx, { id: p.id, reason: "no funds" });
    await expect(bounceCheque(t.ctx, { id: p.id, reason: "again" })).rejects.toThrow();
    // Back to what was owed before the cheque: not the cheque counted twice.
    expect(await owed()).toBe("392.00");
    expect((await getDayEndEntry(t.ctx, a.id)).pendingNow.toFixed(2)).toBe("392.00");
    const next = await book(t.bilal.id, [[t.chips.id, "1"]]);
    expect((await getBillView(t.ctx, next.id)).previous.toFixed(2)).toBe("392.00");
    // Undoing that day-end afterwards does not reverse the bounced payment again.
    await undoDayEnd(t.ctx, { id: a.id, reason: "re-enter" });
    expect(await owed()).toBe("392.00");
  });
});

describe("daily report", () => {
  it("adds up the day's deliveries, products sold, money, pending and stock", async () => {
    const a = await book(t.ali.id, [[t.chips.id, "2"]]);
    const tr = await trip([a.id]);
    await dispatchTrip(t.staff, { id: tr.id });
    // 1 dozen comes back; 100 cash.
    await saveDayEnd(t.staff, {
      orderId: a.id,
      lines: [{ productId: t.chips.id, returned: "12pk", damaged: "" }],
      cash: "100",
    });
    const day = new Date(`${DAY}T00:00:00.000Z`);
    const r = await dailyReport(t.ctx, day);

    expect([r.deliveries.orders, r.deliveries.partly, r.deliveries.stillOut]).toEqual([1, 1, 0]);
    expect([r.deliveries.sent, r.deliveries.kept, r.deliveries.returnedQty]).toEqual([24, 12, 12]);
    // 1 dz chips kept at 200 − 4 discount; cost at the purchase rate of 100.
    expect(
      r.productsSold.map((p) => [p.code, p.quantity, p.amount.toFixed(2), p.cost?.toFixed(2)]),
    ).toEqual([["CB01", 12, "196.00", "100.00"]]);
    expect([r.profit?.gross.toFixed(2), r.profit?.net.toFixed(2)]).toEqual(["96.00", "96.00"]);
    expect(r.money!.collections.cash.atDelivery.toFixed(2)).toBe("100.00");
    expect(r.money!.cashInHand.net.toFixed(2)).toBe("100.00");
    // Ali: 4000 opening + 196 − 100.
    expect(r.money!.pending.top.map((c) => [c.name, c.balance.toFixed(2)])).toEqual([
      ["Ali", "4096.00"],
    ]);
    const chips = r.stock.find((x) => x.code === "CB01")!;
    expect([chips.opening, chips.dispatched, chips.returned, chips.closing]).toEqual([
      600, 24, 12, 588,
    ]);

    // Staff: no money, cost or profit.
    const staff = await dailyReport(t.staff, day);
    expect([staff.money, staff.profit, staff.productsSold[0]!.cost]).toEqual([null, null, null]);
  });
});

describe("dashboard for a chosen day", () => {
  it("shows that day's trips, deliveries and bills, also for a future trip already entered", async () => {
    const future = "2026-11-03";
    const a = await book(t.ali.id, [[t.chips.id, "2"]], { deliveryDate: future });
    const b = await book(t.bilal.id, [[t.nimko.id, "1"]], { deliveryDate: future });
    const tr = await trip([a.id, b.id], { tripDate: future });
    await dispatchTrip(t.staff, { id: tr.id });
    // Ali returns 1 dozen and pays cash; Bilal's day-end is not entered yet.
    await saveDayEnd(t.staff, {
      orderId: a.id,
      lines: [{ productId: t.chips.id, returned: "12pk", damaged: "" }],
      cash: "100",
    });

    const d = await getDashboard(t.ctx, { date: new Date(`${future}T00:00:00.000Z`) });
    const w = d.work.day;
    expect(w.trips.map((x) => [x.number, x.status, x.orders, x.toEnter])).toEqual([
      [tr.number, "DISPATCHED", 2, 1],
    ]);
    expect([w.out, w.orders, w.partly, w.stillOut]).toEqual([1, 2, 1, 1]);
    expect([w.sent, w.returnedQty]).toEqual([36, 12]);
    // Ali's bill after the return (1 dz × 196) + Bilal's bill as sent (1 dz × 150).
    expect(w.billed.toFixed(2)).toBe("346.00");
    expect(d.money!.collected.cash.amount.toFixed(2)).toBe("100.00");

    // Another day has none of it.
    const other = await getDashboard(t.ctx, { date: new Date("2026-11-04T00:00:00.000Z") });
    expect([other.work.day.trips.length, other.work.day.orders]).toEqual([0, 0]);
  });
});
describe("business analysis", () => {
  const deliver = async (date: string, orders: [string, [string, string][]][]) => {
    const ids = [];
    for (const [customerId, lines] of orders)
      ids.push((await book(customerId, lines, { orderDate: date, deliveryDate: date })).id);
    const tr = await trip(ids, { tripDate: date });
    await dispatchTrip(t.staff, { id: tr.id });
    for (const id of ids) await saveDayEnd(t.staff, { orderId: id, lines: [] });
  };

  it("compares a month with the one before: products, companies and customers", async () => {
    // September: Ali 2 dz chips, Bilal 1 dz nimko. October: Ali 5 dz chips, Bilal nothing.
    await deliver("2026-09-10", [
      [t.ali.id, [[t.chips.id, "2"]]],
      [t.bilal.id, [[t.nimko.id, "1"]]],
    ]);
    await deliver("2026-10-05", [[t.ali.id, [[t.chips.id, "5"]]]]);
    const a = await businessAnalysis(t.ctx, "month", new Date("2026-10-15T00:00:00.000Z"));

    expect([a.current.label, a.previous.label]).toEqual(["Oct 2026", "Sep 2026"]);
    // 5 dz × 196 against 2 × 196 + 150.
    expect([a.overview.sales.current.toFixed(2), a.overview.sales.previous.toFixed(2)]).toEqual([
      "980.00",
      "542.00",
    ]);
    expect(a.overview.gross!.current.toFixed(2)).toBe("480.00"); // cost 5 dz × 100
    expect(a.trend).toHaveLength(12);
    expect(a.trend.at(-1)!.sales.toFixed(2)).toBe("980.00");

    expect(a.products.rows.map((r) => [r.code, r.qty.current.toNumber(), r.trend])).toEqual([
      ["CB01", 60, "RISING"],
      ["GC01", 0, "STOPPED"],
    ]);
    expect(a.products.declining.map((r) => r.code)).toEqual(["GC01"]);

    const crunchy = a.companies!.find((c) => c.name === "Crunchy")!;
    expect([crunchy.gross.current.toFixed(2), crunchy.margin?.toFixed(1)]).toEqual([
      "480.00",
      "49.0",
    ]);

    const byName = new Map(a.customers!.rows.map((r) => [r.name, r]));
    expect(byName.get("Ali")!.trend).toBe("RISING");
    expect(byName.get("Bilal")!.trend).toBe("STOPPED");
    // Bilal's September bill is still unpaid, more than 30 days on.
    expect(byName.get("Bilal")!.late).toBe(true);
    expect(a.customers!.stopped.map((r) => r.name)).toEqual(["Bilal"]);

    // Staff: demand and sales only.
    const staff = await businessAnalysis(t.staff, "month", new Date("2026-10-15T00:00:00.000Z"));
    expect([staff.companies, staff.customers, staff.overview.gross]).toEqual([null, null, null]);
    expect(staff.products.rows[0]!.profit).toBeNull();
  });
});
