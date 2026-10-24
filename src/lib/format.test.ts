import { describe, expect, it } from "vitest";

import { formatDateTime, formatDiscount, formatMoney } from "./format";

describe("formatDateTime", () => {
  it("shows Pakistan time by default", () => {
    // 21:30 UTC is 02:30 the next day in PKT (UTC+5).
    expect(formatDateTime(new Date("2026-10-24T21:30:00Z"))).toBe("25 Oct 2026, 2:30 am");
  });
});

describe("formatMoney", () => {
  it("groups thousands and always shows paisa", () => {
    expect(formatMoney("1320")).toBe("1,320.00");
    expect(formatMoney("1234567.5")).toBe("1,234,567.50");
    expect(formatMoney("-250.25")).toBe("-250.25");
    expect(formatMoney(null)).toBe("—");
  });
});

describe("formatDiscount", () => {
  it("describes each discount type", () => {
    expect(formatDiscount({ discountType: "AMOUNT_PER_UNIT", discountValue: "200.00" })).toBe(
      "Rs 200/dz",
    );
    expect(formatDiscount({ discountType: "PERCENT", discountValue: "2.50" })).toBe("2.5%");
    expect(formatDiscount({ discountType: "NONE", discountValue: "0" })).toBe("—");
  });
});
