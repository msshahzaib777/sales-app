import { describe, expect, it } from "vitest";

import { rankText } from "./combobox";

describe("rankText", () => {
  it("ranks code matches above name matches", () => {
    expect(rankText("cb01", "CB01", "Masala Chips")).toBe(100);
    expect(rankText("cb", "CB01", "Masala Chips")).toBe(80);
    expect(rankText("chips", "CB01", "Masala Chips")).toBe(40);
    expect(rankText("ala", "CB01", "Masala Chips")).toBe(20);
  });

  it("matches several words in any order and in any field", () => {
    expect(rankText("kh ali", null, "Ali Khan", "Khan Store")).toBeGreaterThan(0);
    expect(rankText("ali kiryana", null, "Ali Mughal", "Mughal Kiryana Store")).toBe(40);
    expect(rankText("ali bakers", null, "Ali Mughal", "Mughal Kiryana Store")).toBe(0);
  });
});
