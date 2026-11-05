import { describe, expect, it } from "vitest";

import { discountText, parseDiscount, parseSlabs, shortMoney, slabsText } from "./rate-sheet";

describe("rates sheet cells", () => {
  it("writes money short", () => {
    expect(shortMoney("110.00")).toBe("110");
    expect(shortMoney("5.50")).toBe("5.5");
  });

  it("writes and reads the discount", () => {
    expect(discountText("PERCENT", "5.00")).toBe("5%");
    expect(discountText("AMOUNT_PER_UNIT", "7.50")).toBe("7.5");
    expect(discountText("NONE", "0")).toBe("");
    expect(parseDiscount("5%")).toEqual({ ok: true, discountType: "PERCENT", discountValue: "5" });
    expect(parseDiscount(" 2.5 % ")).toMatchObject({
      discountType: "PERCENT",
      discountValue: "2.5",
    });
    expect(parseDiscount("Rs 5")).toMatchObject({
      discountType: "AMOUNT_PER_UNIT",
      discountValue: "5",
    });
    expect(parseDiscount("7.5")).toMatchObject({ discountType: "AMOUNT_PER_UNIT" });
    expect(parseDiscount("")).toMatchObject({ discountType: "NONE", discountValue: "0" });
    expect(parseDiscount("0")).toMatchObject({ discountType: "NONE" });
    expect(parseDiscount("five")).toMatchObject({ ok: false });
  });

  it("writes and reads quantity slabs (from N dozen)", () => {
    expect(
      slabsText([
        { minQuantity: 300, discountValue: "3.00" },
        { minQuantity: 600, discountValue: "5.00" },
      ]),
    ).toBe("25=3, 50=5");
    expect(parseSlabs("25=3, 50=5")).toEqual({
      ok: true,
      slabs: [
        { fromDozens: "25", value: "3" },
        { fromDozens: "50", value: "5" },
      ],
    });
    expect(parseSlabs("25:3; 50 = 5%")).toMatchObject({ ok: true, slabs: [{}, { value: "5" }] });
    expect(parseSlabs("")).toEqual({ ok: true, slabs: [] });
    expect(parseSlabs("25 3")).toMatchObject({ ok: false });
  });
});
