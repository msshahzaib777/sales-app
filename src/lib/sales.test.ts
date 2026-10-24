import { describe, expect, it } from "vitest";

import { billTotals, canTransition, checkCredit, isOpenOrder, priceLine } from "./sales";

const chips = {
  id: "p1",
  companyId: "c1",
  saleRate: "228",
  discountType: "AMOUNT_PER_UNIT" as const,
  discountValue: "4",
  tiers: [{ minQuantity: 50, discountType: "AMOUNT_PER_UNIT" as const, discountValue: "8" }],
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
    const line = priceLine(chips, 7); // 3.5 dz
    expect([
      line.grossAmount.toFixed(2),
      line.discountAmount.toFixed(2),
      line.netAmount.toFixed(2),
    ]).toEqual(["798.00", "14.00", "784.00"]);
    expect(line).toMatchObject({ companyId: "c1", discountType: "AMOUNT_PER_UNIT" });
  });

  it("switches to the slab the quantity reaches, for the whole line", () => {
    const line = priceLine(chips, 50); // 25 dz
    expect([line.discountValue.toFixed(2), line.netAmount.toFixed(2)]).toEqual(["8.00", "5500.00"]);
  });
});

describe("billTotals", () => {
  it("totals the bill and each company's slice", () => {
    const lines = [priceLine(chips, 4), priceLine(nimko, 3), priceLine(chips, 2)];
    const { total, byCompany } = billTotals(lines);
    expect([total.netAmount.toFixed(2), total.quantity]).toEqual(["1017.00", 9]);
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
