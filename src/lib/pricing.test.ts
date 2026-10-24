import { describe, expect, it } from "vitest";

import { calculateLineAmounts, resolveDiscount, sumLineAmounts } from "./pricing";

const asStrings = (amounts: ReturnType<typeof calculateLineAmounts>) => ({
  grossAmount: amounts.grossAmount.toFixed(2),
  discountAmount: amounts.discountAmount.toFixed(2),
  taxAmount: amounts.taxAmount.toFixed(2),
  netAmount: amounts.netAmount.toFixed(2),
});

describe("calculateLineAmounts", () => {
  it("prices half dozens at the per-dozen rate", () => {
    // 7 half dozens = 3.5 dozen × 420
    expect(
      asStrings(calculateLineAmounts({ quantity: 7, baseUnitsPerPriceUnit: 2, rate: 420 })),
    ).toEqual({
      grossAmount: "1470.00",
      discountAmount: "0.00",
      taxAmount: "0.00",
      netAmount: "1470.00",
    });
  });

  it("applies a percent discount with half-up rounding to paisa", () => {
    const amounts = calculateLineAmounts({
      quantity: 3,
      baseUnitsPerPriceUnit: 2,
      rate: "333.33",
      discountType: "PERCENT",
      discountValue: "2.5",
    });
    // gross = 1.5 × 333.33 = 499.995 → 500.00; discount = 12.50
    expect(asStrings(amounts)).toEqual({
      grossAmount: "500.00",
      discountAmount: "12.50",
      taxAmount: "0.00",
      netAmount: "487.50",
    });
  });

  it("applies a fixed discount per price unit", () => {
    const amounts = calculateLineAmounts({
      quantity: 5,
      baseUnitsPerPriceUnit: 2,
      rate: 240,
      discountType: "AMOUNT_PER_UNIT",
      discountValue: 6,
    });
    expect(asStrings(amounts)).toMatchObject({
      grossAmount: "600.00",
      discountAmount: "15.00",
      netAmount: "585.00",
    });
  });

  it("never discounts below zero", () => {
    const amounts = calculateLineAmounts({
      quantity: 2,
      baseUnitsPerPriceUnit: 2,
      rate: 10,
      discountType: "AMOUNT_PER_UNIT",
      discountValue: 50,
    });
    expect(amounts.netAmount.toFixed(2)).toBe("0.00");
  });

  it("adds tax on the discounted amount when a tax rate is set", () => {
    const amounts = calculateLineAmounts({
      quantity: 4,
      baseUnitsPerPriceUnit: 2,
      rate: 100,
      discountType: "PERCENT",
      discountValue: 10,
      taxRate: 17,
    });
    expect(asStrings(amounts)).toEqual({
      grossAmount: "200.00",
      discountAmount: "20.00",
      taxAmount: "30.60",
      netAmount: "210.60",
    });
  });

  it("rejects fractional base quantities and bad conversions", () => {
    expect(() =>
      calculateLineAmounts({ quantity: 1.5, baseUnitsPerPriceUnit: 2, rate: 1 }),
    ).toThrow();
    expect(() =>
      calculateLineAmounts({ quantity: 1, baseUnitsPerPriceUnit: 0, rate: 1 }),
    ).toThrow();
    expect(() =>
      calculateLineAmounts({
        quantity: 1,
        baseUnitsPerPriceUnit: 2,
        rate: 1,
        discountType: "PERCENT",
        discountValue: 101,
      }),
    ).toThrow();
  });
});

describe("sumLineAmounts", () => {
  it("adds line totals exactly", () => {
    const lines = Array.from({ length: 3 }, () =>
      calculateLineAmounts({ quantity: 1, baseUnitsPerPriceUnit: 2, rate: "0.20" }),
    );
    expect(sumLineAmounts(lines).netAmount.toFixed(2)).toBe("0.30");
  });
});

describe("resolveDiscount", () => {
  // Rs 4 per dozen normally; Rs 8 per dozen from 25 dozen; Rs 10 per dozen from 50 dozen.
  const base = { discountType: "AMOUNT_PER_UNIT" as const, discountValue: 4 };
  const tiers = [
    { minQuantity: 100, discountType: "AMOUNT_PER_UNIT" as const, discountValue: 10 },
    { minQuantity: 50, discountType: "AMOUNT_PER_UNIT" as const, discountValue: 8 },
  ];

  it("uses the base discount below the first slab", () => {
    expect(resolveDiscount(base, tiers, 49)).toEqual(base);
  });

  it("uses the slab reached, from its threshold upward", () => {
    expect(resolveDiscount(base, tiers, 50).discountValue).toBe(8);
    expect(resolveDiscount(base, tiers, 99).discountValue).toBe(8);
  });

  it("uses the highest slab reached regardless of tier order", () => {
    expect(resolveDiscount(base, tiers, 120).discountValue).toBe(10);
  });

  it("applies the slab to the whole line", () => {
    // 25 dozen at Rs 228 with Rs 8/dz off = 5700 − 200 = 5500
    const discount = resolveDiscount(base, tiers, 50);
    const amounts = calculateLineAmounts({
      quantity: 50,
      baseUnitsPerPriceUnit: 2,
      rate: 228,
      ...discount,
    });
    expect(amounts.discountAmount.toFixed(2)).toBe("200.00");
    expect(amounts.netAmount.toFixed(2)).toBe("5500.00");
  });

  it("returns only the discount fields when given a whole product as the base", () => {
    const product = { id: "p1", name: "Wavy Chips", saleRate: 228, ...base };
    expect(resolveDiscount(product, [], 10)).toEqual(base);
  });

  it("falls back to the base discount when there are no slabs", () => {
    expect(resolveDiscount(base, [], 500)).toEqual(base);
  });
});
