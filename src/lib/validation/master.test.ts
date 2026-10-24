import { describe, expect, it } from "vitest";

import { bikeSchema, companySchema, customerSchema, productSchema, staffSchema } from "./master";

const product = {
  companyId: "c1",
  code: " cb-01 ",
  name: "Masala Chips",
  purchaseRate: "1,200",
  saleRate: "1320.5",
  discountType: "AMOUNT_PER_UNIT",
  discountValue: "200",
  slabs: [{ fromDozens: "25", value: "250" }],
  minStockLevel: "12.5",
  effectiveFrom: "2026-10-24",
};

describe("productSchema", () => {
  it("normalises code, money and dozens", () => {
    const p = productSchema.parse(product);
    expect(p).toMatchObject({
      code: "CB-01",
      purchaseRate: "1200",
      saleRate: "1320.5",
      discountValue: "200",
      minStockLevel: 150,
      slabs: [{ fromDozens: 300, value: "250" }],
    });
    expect(p.effectiveFrom.toISOString()).toBe("2026-10-24T00:00:00.000Z");
  });

  it("treats blank optional fields as their defaults", () => {
    const p = productSchema.parse({
      ...product,
      discountType: "",
      discountValue: "",
      minStockLevel: "",
      slabs: undefined,
    });
    expect(p).toMatchObject({
      discountType: "NONE",
      discountValue: "0",
      minStockLevel: 0,
      slabs: [],
    });
  });

  it("rejects bad money, quarter dozens, >100% and duplicate slabs", () => {
    const issues = (input: object) =>
      productSchema.safeParse({ ...product, ...input }).error?.issues.map((i) => i.path.join("."));
    expect(issues({ saleRate: "12.345" })).toEqual(["saleRate"]);
    expect(issues({ saleRate: "-5" })).toEqual(["saleRate"]);
    expect(issues({ minStockLevel: "1.04" })).toEqual(["minStockLevel"]);
    expect(issues({ discountType: "PERCENT", discountValue: "120", slabs: [] })).toEqual([
      "discountValue",
    ]);
    expect(
      issues({
        slabs: [
          { fromDozens: "25", value: "1" },
          { fromDozens: "25", value: "2" },
        ],
      }),
    ).toEqual(["slabs.1.fromDozens"]);
    expect(issues({ discountType: "NONE", discountValue: "5" })).toEqual(["discountType"]);
  });
});

describe("customerSchema", () => {
  it("allows a blank credit limit (no limit) and signed opening balances", () => {
    const c = customerSchema.parse({
      name: "Ali",
      type: "RETAILER",
      creditLimit: "",
      areaId: "",
      routeSequence: "",
      openingBalances: { c1: "5,000", c2: "-250.5", c3: "" },
    });
    expect(c).toMatchObject({ creditLimit: null, areaId: null, routeSequence: null, phone: null });
    expect(c.openingBalances).toEqual({ c1: "5000", c2: "-250.5", c3: "0" });
  });

  it("validates phone numbers", () => {
    expect(
      customerSchema.safeParse({ name: "A", type: "DEALER", phone: "0300-1234567" }).success,
    ).toBe(true);
    expect(customerSchema.safeParse({ name: "A", type: "DEALER", phone: "call me" }).success).toBe(
      false,
    );
  });
});

describe("other schemas", () => {
  it("company payment terms and opening balance", () => {
    const c = companySchema.parse({
      warehouseId: "w",
      name: "X",
      paymentTermsDays: "15",
      openingBalance: "",
    });
    expect(c).toMatchObject({ paymentTermsDays: 15, openingBalance: "0" });
    expect(
      companySchema.safeParse({ warehouseId: "w", name: "X", paymentTermsDays: "400" }).success,
    ).toBe(false);
  });

  it("bike capacity in dozens → packets", () => {
    expect(bikeSchema.parse({ name: "Bike 1", capacity: "90" }).capacity).toBe(1080);
    expect(bikeSchema.safeParse({ name: "Bike 1", capacity: "0" }).success).toBe(false);
  });

  it("staff salary and optional joining date", () => {
    expect(
      staffSchema.parse({
        name: "Akram",
        role: "DRIVER",
        monthlySalary: "32,000",
        joiningDate: "",
      }),
    ).toMatchObject({
      monthlySalary: "32000",
      joiningDate: null,
    });
  });
});
