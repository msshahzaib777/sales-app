import { describe, expect, it } from "vitest";

import { calculateLineAmounts, sumLineAmounts } from "./pricing";

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
