import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";

import { ForbiddenError } from "../../auth/permissions";
import { prisma } from "../../db/client";
import { createTenantDb } from "../../db/tenant";
import type { ServiceCtx } from "../master/common";
import { businessToday, toDateInput } from "@/lib/dates";

import { createCompany, updateCompany } from "../master/companies";
import { createProduct } from "../master/products";
import { createWarehouse } from "../master/warehouses";
import { getCompanyBill, listCompanyBills, openBillsFor, updateBillDueDate } from "./bills";
import { cancelClaim, createClaim } from "./claims";
import { getCompanyLedger } from "./company-ledger";
import { cancelGoodsReceipt, createGoodsReceipt } from "./goods-receipts";
import { createCompanyPayment, reverseCompanyPayment } from "./payments";
import {
  createPurchaseOrder,
  getPurchaseOrder,
  setPurchaseOrderStatus,
  updatePurchaseOrder,
} from "./purchase-orders";

const D = (v: Prisma.Decimal | null | undefined) => (v ? v.toFixed(2) : null);

async function setup() {
  const suffix = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({ data: { name: `P ${suffix}`, slug: `p-${suffix}` } });
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `p-${suffix}@t.local`,
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
  const product = (code: string, purchaseRate: string) =>
    createProduct(ctx, {
      companyId: company.id,
      code,
      name: `Chips ${code}`,
      purchaseRate,
      saleRate: "2000",
      effectiveFrom: "2026-10-01",
    });
  const p1 = await product("P1", "1200");
  const p2 = await product("P2", "600");
  return { ctx, as, tenant, warehouse, company, p1, p2 };
}

let t: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  t = await setup();
});

const receive = (ctx: ServiceCtx, extra: Record<string, unknown>) =>
  createGoodsReceipt(ctx, { companyId: t.company.id, receivedDate: "2026-10-10", ...extra });

async function stockOf(productId: string) {
  const sum = await t.ctx.db.stockMovement.aggregate({
    where: { productId, bucket: "SALEABLE" },
    _sum: { quantity: true },
  });
  return sum._sum.quantity ?? 0;
}

describe("purchase orders", () => {
  it("staff order at the product's purchase rate, whatever rate they send", async () => {
    const po = await createPurchaseOrder(t.as("STAFF"), {
      companyId: t.company.id,
      orderDate: "2026-10-01",
      lines: [{ productId: t.p1.id, quantity: "10", rate: "1" }],
    });
    const full = await getPurchaseOrder(t.ctx, po.id);
    expect(full.lines[0]).toMatchObject({ quantity: 20 });
    expect(D(full.lines[0]!.rate)).toBe("1200.00");
    // And staff do not see the rate at all.
    expect((await getPurchaseOrder(t.as("STAFF"), po.id)).lines[0]!.rate).toBeNull();
  });

  it("tracks ordered vs received, allows over-delivery, and locks once received", async () => {
    const po = await createPurchaseOrder(t.ctx, {
      companyId: t.company.id,
      orderDate: "2026-10-01",
      lines: [
        { productId: t.p1.id, quantity: "10" },
        { productId: t.p2.id, quantity: "5" },
      ],
    });
    await receive(t.as("STAFF"), {
      purchaseOrderId: po.id,
      lines: [{ productId: t.p1.id, quantity: "6" }],
    });
    let full = await getPurchaseOrder(t.ctx, po.id);
    expect(full.status).toBe("PARTIALLY_RECEIVED");
    expect(full.lines.map((l) => [l.received, l.variance])).toEqual([
      [12, -8],
      [0, -10],
    ]);
    await expect(
      updatePurchaseOrder(t.ctx, po.id, {
        companyId: t.company.id,
        orderDate: "2026-10-01",
        lines: [{ productId: t.p1.id, quantity: "1" }],
      }),
    ).rejects.toThrow("Only open purchase orders");

    await receive(t.ctx, {
      purchaseOrderId: po.id,
      receivedDate: "2026-10-12",
      lines: [
        { productId: t.p1.id, quantity: "5" },
        { productId: t.p2.id, quantity: "5" },
      ],
    });
    full = await getPurchaseOrder(t.ctx, po.id);
    expect(full.status).toBe("RECEIVED");
    expect(full.lines.map((l) => l.variance)).toEqual([2, 0]);
  });

  it("cancels an untouched order and closes a partly received one", async () => {
    const po = await createPurchaseOrder(t.ctx, {
      companyId: t.company.id,
      orderDate: "2026-10-01",
      lines: [{ productId: t.p1.id, quantity: "10" }],
    });
    await expect(setPurchaseOrderStatus(t.ctx, { id: po.id }, "CLOSED")).rejects.toThrow(
      "partly received",
    );
    await setPurchaseOrderStatus(t.ctx, { id: po.id }, "CANCELLED");
    await expect(
      receive(t.ctx, { purchaseOrderId: po.id, lines: [{ productId: t.p1.id, quantity: "1" }] }),
    ).rejects.toThrow("cancelled");
  });
});

describe("goods receipts", () => {
  it("adds stock as a new batch, creates the bill with due date, and credits the ledger", async () => {
    const receipt = await receive(t.as("STAFF"), {
      supplierRef: "INV-1",
      dueDate: "2026-12-31", // ignored: staff cannot change due dates
      lines: [
        { productId: t.p1.id, quantity: "10" },
        { productId: t.p2.id, quantity: "2.5" },
      ],
    });
    expect(await stockOf(t.p1.id)).toBe(20);
    expect(await stockOf(t.p2.id)).toBe(5);
    expect(await t.ctx.db.batch.count()).toBe(2);
    const bill = receipt.companyBill;
    // 10 dz × 1200 + 2.5 dz × 600
    expect(D(bill.grossAmount)).toBe("13500.00");
    expect(bill.dueDate.toISOString().slice(0, 10)).toBe("2026-10-25");
    const ledger = await t.ctx.db.ledgerEntry.findMany({
      where: { companyId: t.company.id, type: "COMPANY_BILL" },
    });
    expect(ledger.map((e) => D(e.credit))).toEqual(["13500.00"]);
  });

  it("owners and accountants may set a different due date, and change it later", async () => {
    const { companyBill } = await receive(t.as("ACCOUNTANT"), {
      dueDate: "2026-11-30",
      lines: [{ productId: t.p1.id, quantity: "1" }],
    });
    expect(companyBill.dueDate.toISOString().slice(0, 10)).toBe("2026-11-30");
    await updateBillDueDate(t.ctx, { billId: companyBill.id, dueDate: "2026-12-15" });
    await expect(
      updateBillDueDate(t.as("STAFF"), { billId: companyBill.id, dueDate: "2026-12-20" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      updateBillDueDate(t.ctx, { billId: companyBill.id, dueDate: "2026-01-01" }),
    ).rejects.toThrow("before the bill date");
  });

  it("is idempotent per request id", async () => {
    const requestId = randomUUID();
    const a = await receive(t.ctx, { requestId, lines: [{ productId: t.p1.id, quantity: "1" }] });
    const b = await receive(t.ctx, { requestId, lines: [{ productId: t.p1.id, quantity: "1" }] });
    expect(b.id).toBe(a.id);
    expect(await stockOf(t.p1.id)).toBe(2);
  });

  it("numbers documents per tenant in sequence", async () => {
    const a = await receive(t.ctx, { lines: [{ productId: t.p1.id, quantity: "1" }] });
    const b = await receive(t.ctx, { lines: [{ productId: t.p1.id, quantity: "1" }] });
    expect([a.number, b.number]).toEqual([1, 2]);
    expect([a.companyBill.number, b.companyBill.number]).toEqual([1, 2]);
  });
});

describe("damage claims", () => {
  it("credit the ledger now and are deducted on the next bill", async () => {
    const claim = await createClaim(t.ctx, {
      companyId: t.company.id,
      productId: t.p1.id,
      type: "DELIVERY_DAMAGE",
      claimDate: "2026-10-05",
      quantity: "1",
    });
    expect(D(claim.amount)).toBe("1200.00");
    const { companyBill } = await receive(t.ctx, {
      lines: [{ productId: t.p1.id, quantity: "5" }],
    });
    expect([
      D(companyBill.grossAmount),
      D(companyBill.claimDeduction),
      D(companyBill.netAmount),
    ]).toEqual(["6000.00", "1200.00", "4800.00"]);
    expect(
      (await t.ctx.db.companyClaim.findUniqueOrThrow({ where: { id: claim.id } })).status,
    ).toBe("APPLIED");
    await expect(cancelClaim(t.ctx, { id: claim.id, reason: "typo" })).rejects.toThrow(
      "already deducted",
    );
  });

  it("a claim bigger than the bill waits for a later bill; a pending claim can be cancelled", async () => {
    const big = await createClaim(t.ctx, {
      companyId: t.company.id,
      productId: t.p1.id,
      type: "OTHER",
      claimDate: "2026-10-05",
      quantity: "10",
    });
    const { companyBill } = await receive(t.ctx, {
      lines: [{ productId: t.p2.id, quantity: "1" }],
    });
    expect(D(companyBill.claimDeduction)).toBe("0.00");
    await cancelClaim(t.ctx, { id: big.id, reason: "Entered twice" });
    const entries = await t.ctx.db.ledgerEntry.findMany({ where: { referenceId: big.id } });
    expect(entries.map((e) => [e.type, D(e.debit), D(e.credit)])).toEqual(
      expect.arrayContaining([
        ["COMPANY_CLAIM", "12000.00", "0.00"],
        ["REVERSAL", "0.00", "12000.00"],
      ]),
    );
  });
});

describe("company payments", () => {
  async function twoBills() {
    const first = await receive(t.ctx, {
      receivedDate: "2026-10-01",
      lines: [{ productId: t.p1.id, quantity: "1" }],
    }); // 1200, due 16th
    const second = await receive(t.ctx, {
      receivedDate: "2026-10-05",
      lines: [{ productId: t.p1.id, quantity: "2" }],
    }); // 2400, due 20th
    return [first.companyBill, second.companyBill] as const;
  }

  it("applies to the oldest bills first and computes bill status", async () => {
    const [b1, b2] = await twoBills();
    await createCompanyPayment(t.ctx, {
      companyId: t.company.id,
      paymentDate: "2026-10-18",
      method: "CASH",
      amount: "2000",
    });
    const s1 = await getCompanyBill(t.ctx, b1.id);
    const s2 = await getCompanyBill(t.ctx, b2.id);
    expect([s1.state.status, D(s1.state.outstanding)]).toEqual(["PAID", "0.00"]);
    expect([s2.state.status, D(s2.state.outstanding)]).toEqual(["PARTIAL", "1600.00"]);
  });

  it("accepts a manual split and rejects impossible ones", async () => {
    const [b1, b2] = await twoBills();
    await createCompanyPayment(t.ctx, {
      companyId: t.company.id,
      paymentDate: "2026-10-18",
      method: "CHEQUE",
      chequeNo: "001234",
      bankName: "HBL",
      chequeDate: "2026-10-18",
      amount: "1000",
      allocationMode: "manual",
      allocations: [{ billId: b2.id, amount: "1000" }],
    });
    expect((await getCompanyBill(t.ctx, b1.id)).state.status).toBe("UNPAID");
    expect((await getCompanyBill(t.ctx, b2.id)).state.status).toBe("PARTIAL");
    expect(await t.ctx.db.cheque.count({ where: { direction: "ISSUED" } })).toBe(1);

    await expect(
      createCompanyPayment(t.ctx, {
        companyId: t.company.id,
        paymentDate: "2026-10-18",
        method: "CASH",
        amount: "500",
        allocationMode: "manual",
        allocations: [{ billId: b1.id, amount: "1300" }],
      }),
    ).rejects.toThrow("only has 1200.00 outstanding");
    await expect(
      createCompanyPayment(t.ctx, {
        companyId: t.company.id,
        paymentDate: "2026-10-18",
        method: "CHEQUE",
        amount: "5",
      }),
    ).rejects.toThrow();
  });

  it("reversing a payment makes its bills unpaid again", async () => {
    const [b1] = await twoBills();
    const payment = await createCompanyPayment(t.ctx, {
      companyId: t.company.id,
      paymentDate: "2026-10-18",
      method: "ONLINE",
      reference: "IBFT-1",
      amount: "1200",
    });
    expect((await getCompanyBill(t.ctx, b1.id)).state.status).toBe("PAID");
    await reverseCompanyPayment(t.ctx, { id: payment.id, reason: "Wrong company" });
    expect((await getCompanyBill(t.ctx, b1.id)).state.status).toBe("UNPAID");
    await expect(reverseCompanyPayment(t.ctx, { id: payment.id, reason: "again" })).rejects.toThrow(
      "already reversed",
    );
  });

  it("is limited to owners and accountants", async () => {
    await expect(
      createCompanyPayment(t.as("STAFF"), {
        companyId: t.company.id,
        paymentDate: "2026-10-18",
        method: "CASH",
        amount: "1",
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("cancelling a goods receipt", () => {
  it("reverses stock, bill and claims, and reopens the purchase order", async () => {
    const po = await createPurchaseOrder(t.ctx, {
      companyId: t.company.id,
      orderDate: "2026-10-01",
      lines: [{ productId: t.p1.id, quantity: "5" }],
    });
    const claim = await createClaim(t.ctx, {
      companyId: t.company.id,
      productId: t.p2.id,
      type: "OTHER",
      claimDate: "2026-10-02",
      quantity: "1",
    });
    const receipt = await receive(t.ctx, {
      purchaseOrderId: po.id,
      lines: [{ productId: t.p1.id, quantity: "5" }],
    });
    expect((await getPurchaseOrder(t.ctx, po.id)).status).toBe("RECEIVED");

    await expect(
      cancelGoodsReceipt(t.as("ACCOUNTANT"), { id: receipt.id, reason: "Typo" }),
    ).rejects.toThrow(ForbiddenError);
    await cancelGoodsReceipt(t.ctx, { id: receipt.id, reason: "Entered on the wrong company" });

    expect(await stockOf(t.p1.id)).toBe(0);
    expect(
      (await t.ctx.db.companyBill.findUniqueOrThrow({ where: { id: receipt.companyBill.id } }))
        .status,
    ).toBe("REVERSED");
    expect(
      (await t.ctx.db.companyClaim.findUniqueOrThrow({ where: { id: claim.id } })).status,
    ).toBe("PENDING");
    expect((await getPurchaseOrder(t.ctx, po.id)).status).toBe("OPEN");
    const ledger = await getCompanyLedger(t.ctx, t.company.id, {});
    // Bill credit and its reversal cancel out; only the pending claim remains (they owe us 600).
    expect(D(ledger.summary.payableNow)).toBe("-600.00");
    await expect(cancelGoodsReceipt(t.ctx, { id: receipt.id, reason: "again" })).rejects.toThrow(
      "already cancelled",
    );
  });

  it("is refused once the bill has payments", async () => {
    const receipt = await receive(t.ctx, { lines: [{ productId: t.p1.id, quantity: "1" }] });
    await createCompanyPayment(t.ctx, {
      companyId: t.company.id,
      paymentDate: "2026-10-18",
      method: "CASH",
      amount: "100",
    });
    await expect(cancelGoodsReceipt(t.ctx, { id: receipt.id, reason: "x x" })).rejects.toThrow(
      "already has payments",
    );
  });
});

describe("company ledger", () => {
  it("shows a running balance that matches open bills, pending claims and advances", async () => {
    await receive(t.ctx, {
      receivedDate: "2026-09-20",
      lines: [{ productId: t.p1.id, quantity: "10" }],
    }); // 12000
    await createClaim(t.ctx, {
      companyId: t.company.id,
      productId: t.p1.id,
      type: "DELIVERY_DAMAGE",
      claimDate: "2026-10-02",
      quantity: "0.5",
    }); // 600 pending
    await createCompanyPayment(t.ctx, {
      companyId: t.company.id,
      paymentDate: "2026-10-03",
      method: "CASH",
      amount: "5000",
    });
    await receive(t.ctx, {
      receivedDate: "2026-10-06",
      lines: [{ productId: t.p2.id, quantity: "4" }],
    }); // 2400 − 600 claim = 1800
    await createCompanyPayment(t.ctx, {
      companyId: t.company.id,
      paymentDate: "2026-10-07",
      method: "CASH",
      amount: "10000",
    }); // 7000 + 1800 → 1200 advance

    const ledger = await getCompanyLedger(t.ctx, t.company.id, {
      from: new Date("2026-10-01T00:00:00Z"),
    });
    expect(D(ledger.opening)).toBe("12000.00");
    expect(ledger.rows.map((r) => [r.typeLabel, D(r.balance)])).toEqual([
      ["Claim", "11400.00"],
      ["Payment", "6400.00"],
      ["Bill", "8800.00"],
      ["Payment", "-1200.00"],
    ]);
    expect(D(ledger.closing)).toBe(D(ledger.summary.payableNow));

    // Consistency: ledger = open bills − pending claims − unallocated payments.
    const open = await openBillsFor(t.ctx.db, t.company.id);
    const outstanding = open.reduce((s, b) => s.add(b.outstanding), new Prisma.Decimal(0));
    const payments = await t.ctx.db.companyPayment.aggregate({
      where: { status: "POSTED" },
      _sum: { amount: true },
    });
    const allocated = await t.ctx.db.companyPaymentAllocation.aggregate({ _sum: { amount: true } });
    const advance = payments._sum.amount!.sub(allocated._sum.amount!);
    expect(D(outstanding.sub(ledger.summary.pendingClaims).sub(advance))).toBe(
      D(ledger.summary.payableNow),
    );
    expect(ledger.bills.map((b) => b.status)).toEqual(["PAID", "PAID"]);
  });

  it("lists overdue bills with days overdue", async () => {
    await receive(t.ctx, {
      receivedDate: "2026-01-01",
      lines: [{ productId: t.p1.id, quantity: "1" }],
    });
    const list = await listCompanyBills(t.ctx, { filter: "overdue", page: 1 });
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0]!.overdue).toBe(true);
    expect(list.rows[0]!.daysOverdue).toBeGreaterThan(200);
  });

  it("is not visible to staff", async () => {
    await expect(getCompanyLedger(t.as("STAFF"), t.company.id, {})).rejects.toThrow(ForbiddenError);
  });
});

describe("tenant isolation", () => {
  it("cannot receive against, pay, or claim on another tenant's records", async () => {
    const other = await setup();
    const theirReceipt = await createGoodsReceipt(other.ctx, {
      companyId: other.company.id,
      receivedDate: "2026-10-10",
      lines: [{ productId: other.p1.id, quantity: "1" }],
    });
    await expect(
      receive(t.ctx, {
        companyId: other.company.id,
        lines: [{ productId: other.p1.id, quantity: "1" }],
      }),
    ).rejects.toThrow("active company");
    await expect(
      createCompanyPayment(t.ctx, {
        companyId: t.company.id,
        paymentDate: "2026-10-18",
        method: "CASH",
        amount: "10",
        allocationMode: "manual",
        allocations: [{ billId: theirReceipt.companyBill.id, amount: "10" }],
      }),
    ).rejects.toThrow("open bills");
    await expect(
      createClaim(t.ctx, {
        companyId: t.company.id,
        productId: other.p1.id,
        type: "OTHER",
        claimDate: "2026-10-01",
        quantity: "1",
      }),
    ).rejects.toThrow("product of this company");
    await expect(
      cancelGoodsReceipt(t.ctx, { id: theirReceipt.id, reason: "hack" }),
    ).rejects.toThrow("not found");
  });
});

describe("opening balance as a bill", () => {
  const today = toDateInput(businessToday());

  it("payments go to the opening balance first, the oldest debt", async () => {
    await updateCompany(t.ctx, t.company.id, {
      warehouseId: t.warehouse.id,
      name: "Crunchy",
      paymentTermsDays: "15",
      openingBalance: "10000",
    });
    await receive(t.ctx, { receivedDate: today, lines: [{ productId: t.p1.id, quantity: "5" }] }); // 6000, due in 15 days
    await createCompanyPayment(t.ctx, {
      companyId: t.company.id,
      paymentDate: today,
      method: "CASH",
      amount: "12000",
    });
    const open = await openBillsFor(t.ctx.db, t.company.id);
    expect(open.map((b) => [b.isOpening, D(new Prisma.Decimal(b.outstanding))])).toEqual([
      [false, "4000.00"],
    ]);

    // The opening balance cannot be lowered below what was paid against it.
    await expect(
      updateCompany(t.ctx, t.company.id, {
        warehouseId: t.warehouse.id,
        name: "Crunchy",
        paymentTermsDays: "15",
        openingBalance: "9000",
      }),
    ).rejects.toThrow("already applied to the opening balance");
  });

  it("follows changes to the opening balance and closes when it is zero", async () => {
    const input = (openingBalance: string) => ({
      warehouseId: t.warehouse.id,
      name: "Crunchy",
      paymentTermsDays: "15",
      openingBalance,
    });
    await updateCompany(t.ctx, t.company.id, input("5000"));
    await updateCompany(t.ctx, t.company.id, input("7000"));
    let bill = await t.ctx.db.companyBill.findFirstOrThrow({ where: { kind: "OPENING_BALANCE" } });
    expect([D(bill.netAmount), bill.status]).toEqual(["7000.00", "POSTED"]);
    await updateCompany(t.ctx, t.company.id, input("0"));
    bill = await t.ctx.db.companyBill.findFirstOrThrow({ where: { kind: "OPENING_BALANCE" } });
    expect(bill.status).toBe("REVERSED");
    expect(await openBillsFor(t.ctx.db, t.company.id)).toEqual([]);
    expect(await t.ctx.db.companyBill.count({ where: { kind: "OPENING_BALANCE" } })).toBe(1);
  });
});
