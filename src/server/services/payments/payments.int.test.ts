import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "../../auth/permissions";
import { prisma } from "../../db/client";
import { createTenantDb } from "../../db/tenant";
import { createTrip, dispatchTrip } from "../delivery/trips";
import { createArea } from "../master/areas";
import { createBike } from "../master/bikes";
import type { ServiceCtx } from "../master/common";
import { createCompany } from "../master/companies";
import { createCustomer } from "../master/customers";
import { createProduct } from "../master/products";
import { createStaff } from "../master/staff";
import { createWarehouse } from "../master/warehouses";
import { createGoodsReceipt } from "../purchasing/goods-receipts";
import { createSalesOrder } from "../sales/orders";
import { getBillView } from "../sales/bills";
import { customerPending } from "../sales/positions";
import { getCompanyReceivables, getCustomerStatement } from "../statements";
import {
  bounceCheque,
  clearCheque,
  clearCustomerFlag,
  createCustomerPayment,
  customerDebt,
  getCustomerPayment,
  listCustomerPayments,
  paymentContext,
  reverseCustomerPayment,
} from "./customer-payments";
import { createOldBill, listOldBills, removeOldBill } from "./old-bills";

const DAY = "2026-10-25";

async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({ data: { name: `Y ${suffix}`, slug: `y-${suffix}` } });
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `y-${suffix}@t.local`,
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
  const area = await createArea(ctx, { warehouseId: wh.id, name: "Shahdara" });
  const company = (name: string) =>
    createCompany(ctx, { warehouseId: wh.id, name, paymentTermsDays: "15", openingBalance: "" });
  const crunchy = await company("Crunchy");
  const golden = await company("Golden");
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
  for (const [companyId, productId] of [
    [crunchy.id, chips.id],
    [golden.id, nimko.id],
  ] as const)
    await createGoodsReceipt(ctx, {
      companyId,
      receivedDate: "2026-10-01",
      lines: [{ productId, quantity: "50" }],
    });
  const driver = await createStaff(ctx, { name: "Aslam", role: "DRIVER", monthlySalary: "0" });
  const bike = await createBike(ctx, { name: "Bike 1", capacity: "90", driverId: driver.id });
  const ali = await createCustomer(ctx, {
    name: "Ali",
    type: "RETAILER",
    areaId: area.id,
    openingBalances: { [crunchy.id]: "3000", [golden.id]: "1000" },
  });
  const bilal = await createCustomer(ctx, { name: "Bilal", type: "RETAILER", areaId: area.id });

  // One dispatched bill for Ali: Crunchy 1960 (10 dz × 196), Golden 300 (2 dz × 150).
  const order = await createSalesOrder(ctx, {
    customerId: ali.id,
    orderDate: "2026-10-24",
    deliveryDate: DAY,
    lines: [
      { productId: chips.id, quantity: "10" },
      { productId: nimko.id, quantity: "2" },
    ],
  });
  const trip = await createTrip(ctx, {
    tripDate: DAY,
    bikeId: bike.id,
    driverId: driver.id,
    orderIds: [order.id],
  });
  await dispatchTrip(ctx, { id: trip.id });
  return { ctx, as, crunchy, golden, ali, bilal, order };
}

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});

const pay = (extra: object, ctx = t.ctx) =>
  createCustomerPayment(ctx, {
    customerId: t.ali.id,
    paymentDate: "2026-10-26",
    method: "CASH",
    ...extra,
  });

const credits = async (paymentId: string) =>
  Object.fromEntries(
    (
      await t.ctx.db.ledgerEntry.findMany({
        where: {
          referenceType: "CustomerPayment",
          referenceId: paymentId,
          type: "CUSTOMER_PAYMENT",
        },
      })
    ).map((e) => [e.companyId === t.crunchy.id ? "Crunchy" : "Golden", e.credit.toFixed(2)]),
  );
const pending = async (customerId = t.ali.id) =>
  (await customerPending(t.ctx.db, customerId)).total.toFixed(2);

describe("office payments, oldest debt first", () => {
  it("pays the opening balance, then the bill, split by each company's unpaid amount", async () => {
    expect(await pending()).toBe("6260.00");
    const p = await pay({ amount: "4500" });
    // 4000 opening (3000 / 1000), then 500 of the 2260 bill split 1960 : 300.
    expect(await credits(p.id)).toEqual({ Crunchy: "3433.63", Golden: "1066.37" });
    const view = await getCustomerPayment(t.ctx, p.id);
    expect(view.allocations.map((a) => [a.company.name, a.amount.toFixed(2)])).toEqual(
      expect.arrayContaining([
        ["Crunchy", "433.63"],
        ["Golden", "66.37"],
      ]),
    );
    expect(await pending()).toBe("1760.00");

    // A second payment of exactly the rest clears every slice.
    await pay({ amount: "1760" });
    expect(await pending()).toBe("0.00");
    const { debt } = await customerDebt(t.ctx.db, t.ali.id);
    expect(debt.bills).toHaveLength(0);
    expect(debt.unbilled.size).toBe(0);
  });

  it("splits by company when told to, and the amounts must add up", async () => {
    await expect(
      pay({
        amount: "500",
        allocationMode: "company",
        companyAmounts: [{ companyId: t.golden.id, amount: "400" }],
      }),
    ).rejects.toThrow(/add up to 400.00/);
    const p = await pay({
      amount: "1500",
      allocationMode: "company",
      companyAmounts: [{ companyId: t.golden.id, amount: "1500" }],
    });
    expect(await credits(p.id)).toEqual({ Golden: "1500.00" });
    // Golden: 1000 opening, then its 300 slice, 200 extra as an advance with Golden.
    const view = await getCustomerPayment(t.ctx, p.id);
    expect(view.allocations.map((a) => a.amount.toFixed(2))).toEqual(["300.00"]);
    const ctxView = await paymentContext(t.ctx, t.ali.id);
    expect(ctxView.companies.find((c) => c.id === t.golden.id)!.owed).toBe("-200.00");
  });

  it("needs a company for an advance when nothing is owed, and retries never post twice", async () => {
    await expect(pay({ customerId: t.bilal.id, amount: "100" })).rejects.toThrow(/owes nothing/);
    const requestId = randomUUID();
    const advance = {
      customerId: t.bilal.id,
      amount: "100",
      requestId,
      allocationMode: "company",
      companyAmounts: [{ companyId: t.crunchy.id, amount: "100" }],
    };
    const first = await pay(advance);
    const again = await pay(advance);
    expect(again.id).toBe(first.id);
    expect(await pending(t.bilal.id)).toBe("-100.00");
  });

  it("is for owners and accountants only", async () => {
    await expect(pay({ amount: "10" }, t.as("STAFF"))).rejects.toThrow(ForbiddenError);
    await expect(listCustomerPayments(t.as("STAFF"), { page: 1 })).rejects.toThrow(ForbiddenError);
    await pay({ amount: "10" }, t.as("ACCOUNTANT"));
  });
});

describe("cheques", () => {
  const cheque = (amount: string) =>
    pay({
      method: "CHEQUE",
      amount,
      chequeNo: "123456",
      bankName: "HBL",
      chequeDate: "2026-10-30",
    });

  it("a bounced cheque reverses the payment, brings the debt back and flags the customer", async () => {
    const p = await cheque("6260");
    expect(await pending()).toBe("0.00");
    await bounceCheque(t.ctx, { id: p.id, reason: "insufficient funds" });
    expect(await pending()).toBe("6260.00");

    const view = await getCustomerPayment(t.ctx, p.id);
    expect([view.status, view.cheque!.status]).toEqual(["REVERSED", "BOUNCED"]);
    const bounce = await t.ctx.db.ledgerEntry.findMany({
      where: { referenceId: p.id, type: "CHEQUE_BOUNCE" },
    });
    expect(bounce).toHaveLength(2);
    expect(bounce.every((e) => e.reversalOfId)).toBe(true);
    const customer = await t.ctx.db.customer.findUniqueOrThrow({ where: { id: t.ali.id } });
    expect(customer.isFlagged).toBe(true);
    expect(customer.flagReason).toMatch(/Cheque 123456 \(HBL\).*insufficient funds/);
    // The bill is unpaid again.
    expect((await customerDebt(t.ctx.db, t.ali.id)).debt.bills).toHaveLength(1);

    await expect(bounceCheque(t.ctx, { id: p.id, reason: "again" })).rejects.toThrow(/reversed/);
    const audit = await t.ctx.db.auditLog.count({
      where: { entityType: "Cheque", action: "REVERSE" },
    });
    expect(audit).toBe(1);

    await expect(clearCustomerFlag(t.as("STAFF"), { id: t.ali.id })).rejects.toThrow(
      ForbiddenError,
    );
    await clearCustomerFlag(t.ctx, { id: t.ali.id });
    const after = await t.ctx.db.customer.findUniqueOrThrow({ where: { id: t.ali.id } });
    expect([after.isFlagged, after.flagReason]).toEqual([false, null]);
  });

  it("a cleared cheque cannot bounce or be reversed; a cash payment can be reversed", async () => {
    const c = await cheque("500");
    await clearCheque(t.ctx, { id: c.id });
    await expect(bounceCheque(t.ctx, { id: c.id, reason: "late" })).rejects.toThrow(
      /already cleared/,
    );
    await expect(reverseCustomerPayment(t.ctx, { id: c.id, reason: "mistake" })).rejects.toThrow(
      /cleared/,
    );
    expect(await pending()).toBe("5760.00");

    const cash = await pay({ amount: "760" });
    await reverseCustomerPayment(t.ctx, { id: cash.id, reason: "entered twice" });
    expect(await pending()).toBe("5760.00");
    const list = await listCustomerPayments(t.ctx, { page: 1, status: "REVERSED" });
    expect(list.rows.map((r) => r.id)).toEqual([cash.id]);
    const pendingCheques = await listCustomerPayments(t.ctx, { page: 1, cheque: "PENDING" });
    expect(pendingCheques.total).toBe(0);
  });
});

describe("ledger views", () => {
  it("customer statement and company receivables agree with the ledger", async () => {
    await pay({ amount: "4500" });
    const all = await getCustomerStatement(t.ctx, t.ali.id, {});
    expect(all.closing.toFixed(2)).toBe("1760.00");
    const crunchyOnly = await getCustomerStatement(t.ctx, t.ali.id, { companyId: t.crunchy.id });
    // 3000 opening + 1960 bill − 3433.63 paid.
    expect(crunchyOnly.closing.toFixed(2)).toBe("1526.37");

    const r = await getCompanyReceivables(t.ctx, t.crunchy.id, {});
    expect(
      r.rows.map((x) => [x.name, x.debit.toFixed(2), x.credit.toFixed(2), x.closing.toFixed(2)]),
    ).toEqual([["Ali", "4960.00", "3433.63", "1526.37"]]);
    // From the payment day on: opening carries the bill and the opening balance.
    const later = await getCompanyReceivables(t.ctx, t.crunchy.id, {
      from: new Date("2026-10-26T00:00:00Z"),
    });
    expect([later.rows[0]!.opening.toFixed(2), later.totals.closing.toFixed(2)]).toEqual([
      "4960.00",
      "1526.37",
    ]);
    await expect(getCompanyReceivables(t.as("STAFF"), t.crunchy.id, {})).rejects.toThrow(
      ForbiddenError,
    );
  });
});

describe("old balance (paper bills, no company)", () => {
  const oldBill = (amount: string, extra: object = {}, ctx = t.ctx) =>
    createOldBill(ctx, { customerId: t.ali.id, billDate: "2026-09-01", amount, ...extra });

  it("counts in what the customer owes but in no company's figures", async () => {
    const requestId = randomUUID();
    const a = await oldBill("700", { billNo: "B-12", requestId });
    expect((await oldBill("700", { billNo: "B-12", requestId })).id).toBe(a.id); // retry
    const entry = await t.ctx.db.ledgerEntry.findFirstOrThrow({
      where: { referenceType: "CustomerOldBill", referenceId: a.id },
    });
    expect([entry.type, entry.companyId, entry.debit.toFixed(2)]).toEqual([
      "OPENING_BALANCE",
      null,
      "700.00",
    ]);
    const p = await customerPending(t.ctx.db, t.ali.id);
    expect([p.total.toFixed(2), p.oldBalance.toFixed(2), p.byCompany.size]).toEqual([
      "6960.00",
      "700.00",
      2,
    ]);
    const receivables = await getCompanyReceivables(t.ctx, t.crunchy.id, {});
    expect(receivables.totals.closing.toFixed(2)).toBe("4960.00"); // 3000 opening + 1960 bill

    const statement = await getCustomerStatement(t.ctx, t.ali.id, {});
    expect(
      statement.rows.find((r) => r.description.startsWith("Old bill #B-12"))?.companyName,
    ).toBe("Old balance");
    expect(statement.byCompany[0]).toMatchObject({ companyId: "", companyName: "Old balance" });
    const crunchyOnly = await getCustomerStatement(t.ctx, t.ali.id, { companyId: t.crunchy.id });
    expect(crunchyOnly.rows.some((r) => r.companyName === "Old balance")).toBe(false);

    // On a new bill: in "previous", shown apart, and in no company's slice.
    const order = await createSalesOrder(t.ctx, {
      customerId: t.ali.id,
      orderDate: "2026-10-26",
      deliveryDate: "2026-10-27",
      lines: [{ productId: (await t.ctx.db.product.findFirstOrThrow()).id, quantity: "1" }],
    });
    const view = await getBillView(t.ctx, order.id);
    expect([view.previous.toFixed(2), view.oldBalance.toFixed(2)]).toEqual(["6960.00", "700.00"]);
    expect(view.sections.map((c) => [c.companyName, c.previous.toFixed(2)])).toEqual([
      ["Crunchy", "4960.00"],
    ]);
  });

  it("is paid before anything else, oldest old bill first", async () => {
    await oldBill("700", { billDate: "2026-08-01" });
    await oldBill("300", { billDate: "2026-09-01" });
    const p = await pay({ amount: "900" });
    const entries = await t.ctx.db.ledgerEntry.findMany({
      where: { referenceType: "CustomerPayment", referenceId: p.id },
    });
    expect(entries.map((e) => [e.companyId, e.credit.toFixed(2)])).toEqual([[null, "900.00"]]);
    const list = await listOldBills(t.ctx, t.ali.id);
    expect(list.rows.map((r) => [r.paid.toFixed(2), r.unpaid.toFixed(2)])).toEqual([
      ["700.00", "0.00"],
      ["200.00", "100.00"],
    ]);
    expect((await paymentContext(t.ctx, t.ali.id)).oldBalance).toBe("100.00");

    // A bounced cheque brings it back.
    const cheque = await pay({
      amount: "100",
      method: "CHEQUE",
      chequeNo: "1",
      bankName: "HBL",
      chequeDate: "2026-10-26",
    });
    expect((await customerPending(t.ctx.db, t.ali.id)).oldBalance.toFixed(2)).toBe("0.00");
    await bounceCheque(t.ctx, { id: cheque.id, reason: "No funds" });
    expect((await customerPending(t.ctx.db, t.ali.id)).oldBalance.toFixed(2)).toBe("100.00");
  });

  it("can be paid in a manual split, but not more than is owed", async () => {
    await oldBill("700");
    await expect(
      pay({
        amount: "800",
        allocationMode: "company",
        companyAmounts: [{ companyId: "", amount: "800" }],
      }),
    ).rejects.toThrow("old balance is only");
    await pay({
      amount: "800",
      allocationMode: "company",
      companyAmounts: [
        { companyId: "", amount: "500" },
        { companyId: t.golden.id, amount: "300" },
      ],
    });
    const p = await customerPending(t.ctx.db, t.ali.id);
    expect([p.oldBalance.toFixed(2), p.byCompany.get(t.golden.id)?.toFixed(2)]).toEqual([
      "200.00",
      "1000.00",
    ]);
  });

  it("is removed by a reversal, not once payments have used it up", async () => {
    const a = await oldBill("700");
    const b = await oldBill("300");
    await pay({ amount: "500" }); // 500 of the 700 bill paid
    await expect(removeOldBill(t.ctx, { id: a.id, reason: "Typo" })).rejects.toThrow(
      "can't be removed",
    );
    await removeOldBill(t.ctx, { id: b.id, reason: "Entered twice" });
    await expect(removeOldBill(t.ctx, { id: b.id, reason: "Again" })).rejects.toThrow(
      "already removed",
    );
    expect((await customerPending(t.ctx.db, t.ali.id)).oldBalance.toFixed(2)).toBe("200.00");
    expect(
      await t.ctx.db.auditLog.count({ where: { entityType: "CustomerOldBill", entityId: b.id } }),
    ).toBe(2);
  });

  it("is the only kind of customer debt the database lets go without a company", async () => {
    await expect(
      t.ctx.db.ledgerEntry.create({
        data: {
          tenantId: t.ctx.user.tenantId,
          partyType: "CUSTOMER",
          customerId: t.ali.id,
          type: "SALES_BILL",
          entryDate: new Date(DAY),
          debit: 1,
        },
      }),
    ).rejects.toThrow(/LedgerEntry_party_check/);
  });

  it("is for the owner and accountant only", async () => {
    await expect(oldBill("100", {}, t.as("STAFF"))).rejects.toThrow(ForbiddenError);
    await oldBill("100", {}, t.as("ACCOUNTANT"));
  });
});
