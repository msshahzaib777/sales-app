import { describe, expect, it } from "vitest";

import {
  billTotals,
  canTransition,
  checkCredit,
  isOpenOrder,
  minimumPayment,
  priceLine,
  priceLineAt,
} from "./sales";

const chips = {
  id: "p1",
  companyId: "c1",
  saleRate: "228",
  discountType: "AMOUNT_PER_UNIT" as const,
  discountValue: "4",
  tiers: [{ minQuantity: 300, discountType: "AMOUNT_PER_UNIT" as const, discountValue: "8" }],
};
const nimko = {
  id: "p2",
  companyId: "c2",
  saleRate: "230",
  discountType: "NONE" as const,
  discountValue: "0",
  tiers: [],
};

describe("priceLine", () => {
  it("applies the company discount per dozen", () => {
    const line = priceLine(chips, 42); // 3.5 dz
    expect([
      line.grossAmount.toFixed(2),
      line.discountAmount.toFixed(2),
      line.netAmount.toFixed(2),
    ]).toEqual(["798.00", "14.00", "784.00"]);
    expect(line).toMatchObject({ companyId: "c1", discountType: "AMOUNT_PER_UNIT" });
  });

  it("switches to the slab the quantity reaches, for the whole line", () => {
    const line = priceLine(chips, 300); // 25 dz
    expect([line.discountValue.toFixed(2), line.netAmount.toFixed(2)]).toEqual(["8.00", "5500.00"]);
  });

  it("prices loose packets at the per-dozen rate", () => {
    const line = priceLine(nimko, 5); // 5 packets of 230 / dozen
    expect(line.netAmount.toFixed(2)).toBe("95.83");
  });
});

describe("priceLineAt", () => {
  it("prices at the typed rate with no discount, and keeps the normal rate", () => {
    const line = priceLineAt(chips, 42, "200"); // 3.5 dz at 200
    expect([
      line.rate.toFixed(2),
      line.discountAmount.toFixed(2),
      line.netAmount.toFixed(2),
    ]).toEqual(["200.00", "0.00", "700.00"]);
    expect(line.discountType).toBe("NONE");
    expect(line.standardRate?.toFixed(2)).toBe("228.00");
  });

  it("a blank rate, or the product's own rate, prices normally", () => {
    for (const rate of [null, undefined, "", "228", "228.00"]) {
      const line = priceLineAt(chips, 42, rate);
      expect([line.netAmount.toFixed(2), line.standardRate]).toEqual(["784.00", undefined]);
    }
  });
});

describe("billTotals", () => {
  it("totals the bill and each company's slice", () => {
    const lines = [priceLine(chips, 24), priceLine(nimko, 18), priceLine(chips, 12)];
    const { total, byCompany } = billTotals(lines);
    expect([total.netAmount.toFixed(2), total.quantity]).toEqual(["1017.00", 54]);
    expect(byCompany.get("c1")!.netAmount.toFixed(2)).toBe("672.00");
    expect(byCompany.get("c2")!.netAmount.toFixed(2)).toBe("345.00");
  });
});

describe("checkCredit", () => {
  it("counts pending, other open orders and this order", () => {
    const check = checkCredit({
      creditLimit: "25000",
      pending: "18000",
      openOrders: "4000",
      thisOrder: "5000",
    });
    expect(check.exposure.toFixed(2)).toBe("27000.00");
    expect(check.over?.toFixed(2)).toBe("2000.00");
  });

  it("no limit, or within it, is fine; an empty order never warns", () => {
    expect(
      checkCredit({ creditLimit: null, pending: "999999", openOrders: "0", thisOrder: "1" }).over,
    ).toBeNull();
    expect(
      checkCredit({ creditLimit: "25000", pending: "20000", openOrders: "0", thisOrder: "5000" })
        .over,
    ).toBeNull();
    expect(
      checkCredit({ creditLimit: "100", pending: "500", openOrders: "0", thisOrder: "0" }).over,
    ).toBeNull();
  });
});

describe("order statuses", () => {
  it("follows Booked → Planned → Dispatched → Delivered / Partly delivered / Returned", () => {
    expect(canTransition("BOOKED", "PLANNED")).toBe(true);
    expect(canTransition("PLANNED", "DISPATCHED")).toBe(true);
    expect(canTransition("DISPATCHED", "PARTIALLY_DELIVERED")).toBe(true);
    expect(canTransition("DISPATCHED", "CANCELLED")).toBe(false);
    expect(canTransition("DELIVERED", "BOOKED")).toBe(false);
    expect([isOpenOrder("BOOKED"), isOpenOrder("PLANNED"), isOpenOrder("DISPATCHED")]).toEqual([
      true,
      true,
      false,
    ]);
  });
});

describe("minimumPayment", () => {
  const min = (previous: string, totalDue: string, creditLimit: string | null) =>
    minimumPayment({ previous, totalDue, creditLimit }).toFixed(2);

  it("is the earlier balance when the total stays within the limit", () => {
    expect(min("5000", "12000", "20000")).toBe("5000.00");
  });
  it("is what brings the total back within the limit when that is more", () => {
    expect(min("5000", "32000", "20000")).toBe("12000.00");
  });
  it("is the earlier balance when there is no credit limit", () => {
    expect(min("5000", "32000", null)).toBe("5000.00");
  });
  it("is the whole total with a zero limit", () => {
    expect(min("5000", "8000", "0")).toBe("8000.00");
  });
  it("is never negative (advance in hand)", () => {
    expect(min("-3000", "2000", "10000")).toBe("0.00");
  });
});
