import { randomUUID } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";

import { prisma } from "../db/client";
import { createTenantDb } from "../db/tenant";
import { saveDayEnd } from "./delivery/day-end";
import { createTrip, dispatchTrip } from "./delivery/trips";
import {
  getStockCard,
  listStock,
  openingStockSheet,
  returnDamagedStock,
  setOpeningStock,
} from "./inventory";
import { createArea } from "./master/areas";
import { createBike } from "./master/bikes";
import type { ServiceCtx } from "./master/common";
import { createCompany } from "./master/companies";
import { createCustomer } from "./master/customers";
import { createProduct } from "./master/products";
import { createStaff } from "./master/staff";
import { createWarehouse } from "./master/warehouses";
import {
  bounceCheque,
  createCustomerPayment,
  customerDebt,
  reverseCustomerPayment,
} from "./payments/customer-payments";
import { getCompanyLedger } from "./purchasing/company-ledger";
import { cancelGoodsReceipt, createGoodsReceipt } from "./purchasing/goods-receipts";
import { createCompanyPayment } from "./purchasing/payments";
import { getBillView } from "./sales/bills";
import { cancelSalesOrder, createSalesOrder } from "./sales/orders";
import { customerPending, stockPositions } from "./sales/positions";
import { getCompanyReceivables, getCustomerStatement } from "./statements";

// Phase 1 review: one realistic week through every posting path (receipts and a cancelled
// receipt, orders and a cancelled order, dispatch, day-end with returns and damage, office and
// delivery payments, a bounced cheque and a reversed payment, a company payment and a damage claim
// deducted on the next company bill). Then the stock and money journals must agree with every
// screen that reports them, and with hand-worked totals.

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);
const money = (v: Prisma.Decimal | { toString(): string }) => D(v.toString()).toFixed(2);

let ctx: ServiceCtx;
let w: Awaited<ReturnType<typeof week>>;

async function week() {
  const suffix = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({ data: { name: `W ${suffix}`, slug: `w-${suffix}` } });
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `w-${suffix}@t.local`,
      name: "Owner",
      role: "OWNER",
      passwordHash: "x",
    },
  });
  ctx = {
    db: createTenantDb(tenant.id),
    user: { id: owner.id, role: "OWNER", tenantId: tenant.id },
  };
  const wh = await createWarehouse(ctx, { name: "Main" });
  const area = await createArea(ctx, { warehouseId: wh.id, name: "Shahdara" });
  const company = (name: string, openingBalance = "") =>
    createCompany(ctx, { warehouseId: wh.id, name, paymentTermsDays: "15", openingBalance });
  const crunchy = await company("Crunchy", "10000");
  const golden = await company("Golden");
  const product = (
    companyId: string,
    code: string,
    purchaseRate: string,
    saleRate: string,
    extra = {},
  ) =>
    createProduct(ctx, {
      companyId,
      code,
      name: `Item ${code}`,
      purchaseRate,
      saleRate,
      effectiveFrom: "2026-10-01",
      minStockLevel: "30", // 60 half dozens
      ...extra,
    });
  // Chips: buy 150, sell 200 less 4/dz. Nimko: buy 100, sell 150.
  const chips = await product(crunchy.id, "CB01", "150", "200", {
    discountType: "AMOUNT_PER_UNIT",
    discountValue: "4",
  });
  const nimko = await product(golden.id, "GC01", "100", "150");

  // Receipts: chips 50 dz (7500), nimko 30 dz (3000); a second nimko receipt cancelled.
  await createGoodsReceipt(ctx, {
    companyId: crunchy.id,
    receivedDate: "2026-10-20",
    lines: [{ productId: chips.id, quantity: "50" }],
  });
  await createGoodsReceipt(ctx, {
    companyId: golden.id,
    receivedDate: "2026-10-20",
    lines: [{ productId: nimko.id, quantity: "30" }],
  });
  const mistake = await createGoodsReceipt(ctx, {
    companyId: golden.id,
    receivedDate: "2026-10-20",
    lines: [{ productId: nimko.id, quantity: "5" }],
  });
  await cancelGoodsReceipt(ctx, { id: mistake.id, reason: "entered twice" });

  const driver = await createStaff(ctx, { name: "Aslam", role: "DRIVER", monthlySalary: "0" });
  const bike = await createBike(ctx, { name: "Bike 1", capacity: "100", driverId: driver.id });
  const ali = await createCustomer(ctx, {
    name: "Ali",
    type: "RETAILER",
    areaId: area.id,
    openingBalances: { [crunchy.id]: "1000" },
  });
  const bilal = await createCustomer(ctx, { name: "Bilal", type: "RETAILER", areaId: area.id });

  const order = (customerId: string, lines: [string, string][]) =>
    createSalesOrder(ctx, {
      customerId,
      orderDate: "2026-10-21",
      deliveryDate: "2026-10-22",
      lines: lines.map(([productId, quantity]) => ({ productId, quantity })),
    });
  // Ali: chips 10 dz (1960) + nimko 4 dz (600). Bilal: chips 5 dz (980).
  const a = await order(ali.id, [
    [chips.id, "10"],
    [nimko.id, "4"],
  ]);
  const b = await order(bilal.id, [[chips.id, "5"]]);
  const cancelled = await order(bilal.id, [[nimko.id, "3"]]);
  await cancelSalesOrder(ctx, { id: cancelled.id });
  // Booked for later: reserves stock, posts nothing.
  const later = await createSalesOrder(ctx, {
    customerId: bilal.id,
    orderDate: "2026-10-21",
    deliveryDate: "2026-10-23",
    lines: [{ productId: nimko.id, quantity: "6" }],
  });

  const trip = await createTrip(ctx, {
    tripDate: "2026-10-22",
    bikeId: bike.id,
    driverId: driver.id,
    orderIds: [a.id, b.id],
  });
  await dispatchTrip(ctx, { id: trip.id });

  // Day-end: Ali returns 1 dz chips and 1 dz nimko is damaged; pays 1000 cash.
  // Bilal keeps everything and pays 500 online.
  await saveDayEnd(ctx, {
    orderId: a.id,
    lines: [
      { productId: chips.id, returned: "1", damaged: "" },
      { productId: nimko.id, returned: "", damaged: "1" },
    ],
    cash: "1000",
  });
  await saveDayEnd(ctx, { orderId: b.id, lines: [], onlineAmount: "500", onlineReference: "TX1" });

  // Office: Ali pays 800 cash, then a cheque of 300 that bounces; a 50 entered by mistake.
  await createCustomerPayment(ctx, {
    customerId: ali.id,
    paymentDate: "2026-10-23",
    method: "CASH",
    amount: "800",
  });
  const cheque = await createCustomerPayment(ctx, {
    customerId: ali.id,
    paymentDate: "2026-10-23",
    method: "CHEQUE",
    amount: "300",
    chequeNo: "9",
    bankName: "HBL",
    chequeDate: "2026-10-23",
  });
  await bounceCheque(ctx, { id: cheque.id, reason: "bounced" });
  const wrong = await createCustomerPayment(ctx, {
    customerId: ali.id,
    paymentDate: "2026-10-23",
    method: "CASH",
    amount: "50",
  });
  await reverseCustomerPayment(ctx, { id: wrong.id, reason: "wrong customer" });

  // We pay Crunchy 5000; the damage claim (nimko, Golden) is deducted on Golden's next bill.
  await createCompanyPayment(ctx, {
    companyId: crunchy.id,
    paymentDate: "2026-10-23",
    method: "CASH",
    amount: "5000",
  });
  await createGoodsReceipt(ctx, {
    companyId: golden.id,
    receivedDate: "2026-10-24",
    lines: [{ productId: nimko.id, quantity: "10" }],
  });

  return { wh, crunchy, golden, chips, nimko, ali, bilal, a, b, later };
}

beforeAll(async () => {
  w = await week();
}, 120_000);

describe("stock journal", () => {
  it("balances are received − dispatched + returned, and damage sits in its own bucket", async () => {
    const pos = await stockPositions(ctx.db, w.wh.id, [w.chips.id, w.nimko.id]);
    // Chips: 100 received − 30 dispatched + 2 returned = 72 half dozens.
    expect(pos.get(w.chips.id)).toEqual({ onHand: 72, reserved: 0, available: 72 });
    // Nimko: 60 + 20 received (the cancelled 10 nets to zero) − 8 dispatched = 72; 12 reserved.
    expect(pos.get(w.nimko.id)).toEqual({ onHand: 72, reserved: 12, available: 60 });

    const damaged = await ctx.db.stockMovement.groupBy({
      by: ["productId"],
      where: { bucket: "DAMAGED" },
      _sum: { quantity: true },
    });
    expect(damaged.map((g) => [g.productId, g._sum.quantity])).toEqual([[w.nimko.id, 2]]);
  });

  it("the inventory screen and the stock card agree with the journal", async () => {
    const list = await listStock(ctx, { page: 1 });
    const row = (id: string) => list.rows.find((r) => r.id === id)!;
    expect([row(w.chips.id).onHand, row(w.chips.id).damaged, row(w.chips.id).low]).toEqual([
      72,
      0,
      false,
    ]);
    expect([row(w.nimko.id).available, row(w.nimko.id).damaged]).toEqual([60, 2]);
    expect((await listStock(ctx, { page: 1, low: true })).total).toBe(0);

    const card = await getStockCard(ctx, w.nimko.id, {});
    expect(card.closing).toEqual({ saleable: 72, damaged: 2 });
    // Running balance = cumulative sum of the movements shown.
    let saleable = 0;
    for (const r of card.rows) {
      if (r.bucket === "SALEABLE") saleable += r.quantity;
      expect(r.saleable).toBe(saleable);
    }
    // From the day of dispatch: opening is what was there before.
    const fromDispatch = await getStockCard(ctx, w.chips.id, {
      from: new Date("2026-10-22T00:00:00Z"),
    });
    expect(fromDispatch.opening.saleable).toBe(100);
    expect(fromDispatch.closing.saleable).toBe(72);
  });
});

describe("customer ledger", () => {
  it("every customer entry carries a company, and no entry is zero", async () => {
    const entries = await ctx.db.ledgerEntry.findMany({ where: { partyType: "CUSTOMER" } });
    expect(entries.every((e) => e.companyId)).toBe(true);
    expect(entries.every((e) => e.debit.isZero() !== e.credit.isZero())).toBe(true);
  });

  it("pending = opening + bills after day-end − payments that still stand", async () => {
    // Ali: 1000 opening + bill (9 dz chips 1764 + 3 dz nimko 450 = 2214) − 1000 − 800.
    // The bounced cheque and the reversed 50 net to zero.
    expect(money((await customerPending(ctx.db, w.ali.id)).total)).toBe("1414.00");
    // Bilal: 980 bill − 500 online.
    expect(money((await customerPending(ctx.db, w.bilal.id)).total)).toBe("480.00");
  });

  it("each bill's ledger postings equal the bill after day-end, and its revision says the same", async () => {
    for (const orderId of [w.a.id, w.b.id]) {
      const view = await getBillView(ctx, orderId);
      const entries = await ctx.db.ledgerEntry.findMany({
        where: { referenceType: "Bill", referenceId: view.bill.id },
      });
      const posted = entries.reduce((s, e) => s.add(e.debit).sub(e.credit), D(0));
      expect(money(posted)).toBe(money(view.bill.netAmount));
      const bySection = view.sections.reduce((s, x) => s.add(x.thisBill), D(0));
      expect(money(bySection)).toBe(money(view.bill.netAmount));
    }
    expect(money((await getBillView(ctx, w.a.id)).bill.netAmount)).toBe("2214.00");
  });

  it("allocations never exceed a bill slice, and unpaid slices match what is owed", async () => {
    const allocations = await ctx.db.paymentAllocation.findMany({
      where: { customerPayment: { status: "POSTED" } },
    });
    const bills = await ctx.db.bill.findMany({
      include: { revisions: { orderBy: { revision: "desc" }, take: 1 } },
    });
    for (const bill of bills) {
      for (const slice of bill.revisions[0]!.companyTotals as {
        companyId: string;
        netAmount: string;
      }[]) {
        const paid = allocations
          .filter((x) => x.billId === bill.id && x.companyId === slice.companyId)
          .reduce((s, x) => s.add(x.amount), D(0));
        expect(paid.lte(slice.netAmount)).toBe(true);
      }
    }
    // Ali's debt bill by bill adds up to his ledger balance.
    const { debt, pending } = await customerDebt(ctx.db, w.ali.id);
    const owed = [...debt.unbilled.values()]
      .reduce((s, v) => s.add(v.toString()), D(0))
      .add(
        debt.bills.flatMap((b) => b.slices).reduce((s, x) => s.add(x.outstanding.toString()), D(0)),
      );
    expect(money(owed)).toBe(money(pending.total));
  });

  it("statements and company receivables add up to the same balances", async () => {
    for (const customer of [w.ali, w.bilal]) {
      const all = await getCustomerStatement(ctx, customer.id, {});
      expect(money(all.closing)).toBe(money((await customerPending(ctx.db, customer.id)).total));
      const perCompany = await Promise.all(
        [w.crunchy, w.golden].map((c) =>
          getCustomerStatement(ctx, customer.id, { companyId: c.id }),
        ),
      );
      expect(money(perCompany.reduce((s, x) => s.add(x.closing), D(0)))).toBe(money(all.closing));
    }
    const receivables = await Promise.all(
      [w.crunchy, w.golden].map((c) => getCompanyReceivables(ctx, c.id, {})),
    );
    const total = receivables.reduce((s, r) => s.add(r.totals.closing), D(0));
    expect(money(total)).toBe("1894.00");
  });
});

describe("company ledger", () => {
  it("payable = opening + bills − payments − claims, on the ledger and on its screen", async () => {
    const crunchy = await getCompanyLedger(ctx, w.crunchy.id, {});
    // 10000 opening + 7500 bill − 5000 paid.
    expect(money(crunchy.summary.payableNow)).toBe("12500.00");
    expect(money(crunchy.closing)).toBe("12500.00");

    const golden = await getCompanyLedger(ctx, w.golden.id, {});
    // 3000 + (500 cancelled: nets to 0) + 1000 next bill − 100 damage claim (1 dz at cost 100).
    expect(money(golden.summary.payableNow)).toBe("3900.00");
    expect(money(golden.summary.pendingClaims)).toBe("0.00");
    // The claim was deducted on the next bill: its outstanding is 900, not 1000.
    const latest = golden.bills.find((b) => b.claimDeduction.gt(0))!;
    expect([money(latest.netAmount), money(latest.outstanding)]).toEqual(["900.00", "900.00"]);
    expect(money(golden.summary.openBills)).toBe("3900.00");
  });
});

describe("damaged stock sent back to the company", () => {
  it("leaves the damaged bucket without a second credit to the company", async () => {
    const before = await getCompanyLedger(ctx, w.golden.id, {});
    await expect(
      returnDamagedStock(ctx, { productId: w.nimko.id, quantity: "2", returnDate: "2026-10-24" }),
    ).rejects.toThrow(/Only 1 dz/);
    const requestId = randomUUID();
    const input = { productId: w.nimko.id, quantity: "1", returnDate: "2026-10-24", requestId };
    await returnDamagedStock(ctx, input);
    await returnDamagedStock(ctx, input);
    const card = await getStockCard(ctx, w.nimko.id, {});
    expect([card.damagedNow, card.closing.saleable]).toEqual([0, 72]);
    const after = await getCompanyLedger(ctx, w.golden.id, {});
    expect(money(after.summary.payableNow)).toBe(money(before.summary.payableNow));
  });
});

describe("opening stock", () => {
  it("sets first-day stock without a company bill, only posting the difference", async () => {
    const before = await getCompanyLedger(ctx, w.crunchy.id, {});
    const start = (await stockPositions(ctx.db, w.wh.id, [w.chips.id])).get(w.chips.id)!.onHand;
    const requestId = randomUUID();
    const sheet = {
      stockDate: "2026-10-19",
      requestId,
      lines: [{ productId: w.chips.id, quantity: "20" }],
    };
    expect((await setOpeningStock(ctx, sheet)).changed).toBe(1);
    expect((await setOpeningStock(ctx, sheet)).changed).toBe(0);
    const onHand = async () =>
      (await stockPositions(ctx.db, w.wh.id, [w.chips.id])).get(w.chips.id)!.onHand;
    expect(await onHand()).toBe(start + 40);

    // Lowered to 15 dz: only the difference is posted.
    await setOpeningStock(ctx, {
      stockDate: "2026-10-19",
      lines: [{ productId: w.chips.id, quantity: "15" }],
    });
    expect(await onHand()).toBe(start + 30);
    const rows = await openingStockSheet(ctx, {});
    expect(rows.find((r) => r.id === w.chips.id)!.opening).toBe(30);

    // No money moved for the company, and the stock sits in one opening batch.
    const after = await getCompanyLedger(ctx, w.crunchy.id, {});
    expect(after.summary.payableNow.toFixed(2)).toBe(before.summary.payableNow.toFixed(2));
    const batches = await ctx.db.stockMovement.findMany({
      where: { productId: w.chips.id, type: "OPENING" },
      select: { batchId: true },
    });
    expect(new Set(batches.map((b) => b.batchId)).size).toBe(1);
    const card = await getStockCard(ctx, w.chips.id, {});
    expect(card.rows.filter((r) => r.typeLabel === "Opening stock")).toHaveLength(2);

    await expect(
      setOpeningStock({ ...ctx, user: { ...ctx.user, role: "STAFF" } }, sheet),
    ).rejects.toThrow(/permission/);
  });

  it("cannot be lowered below what is left of the opening batch", async () => {
    await setOpeningStock(ctx, {
      stockDate: "2026-10-19",
      lines: [{ productId: w.nimko.id, quantity: "1" }],
    });
    // Take the opening stock out by hand, as dispatch would (oldest batch first).
    const opening = await ctx.db.stockMovement.findFirstOrThrow({
      where: { productId: w.nimko.id, type: "OPENING" },
    });
    await ctx.db.stockMovement.create({
      data: {
        tenantId: ctx.user.tenantId,
        type: "DISPATCH",
        productId: w.nimko.id,
        warehouseId: w.wh.id,
        batchId: opening.batchId,
        quantity: -2,
      },
    });
    await expect(
      setOpeningStock(ctx, {
        stockDate: "2026-10-19",
        lines: [{ productId: w.nimko.id, quantity: "0" }],
      }),
    ).rejects.toThrow(/already been sent out/);
  });
});
