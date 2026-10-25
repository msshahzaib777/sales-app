import { describe, expect, it } from "vitest";

import { dozensToPackets, formatDozens, parseQuantity, quantityText, splitPackets } from "./units";

describe("formatDozens", () => {
  it("shows whole and half dozens", () => {
    expect(formatDozens(0)).toBe("0 dz");
    expect(formatDozens(24)).toBe("2 dz");
    expect(formatDozens(42)).toBe("3.5 dz");
    expect(formatDozens(-18)).toBe("-1.5 dz");
  });

  it("shows loose packets as dozens and packets", () => {
    expect(formatDozens(41)).toBe("3 dz 5 pk");
    expect(formatDozens(5)).toBe("5 pk");
    expect(formatDozens(-13)).toBe("-1 dz 1 pk");
  });

  it("rejects non-integer storage values", () => {
    expect(() => formatDozens(1.5)).toThrow();
  });
});

describe("dozensToPackets", () => {
  it("converts whole and half dozens", () => {
    expect(dozensToPackets(3)).toBe(36);
    expect(dozensToPackets(2.5)).toBe(30);
  });

  it("rejects quantities that are not a multiple of half a dozen", () => {
    expect(() => dozensToPackets(1.25)).toThrow();
  });
});

describe("splitPackets", () => {
  it("gives whole dozens and the packets left over", () => {
    expect(splitPackets(41)).toEqual({ dozens: 3, packets: 5 });
    expect(splitPackets(7)).toEqual({ dozens: 0, packets: 7 });
  });
});

describe("parseQuantity", () => {
  it("reads dozens and packets together, in the usual spellings", () => {
    for (const s of [
      "12dz 4pk",
      "12 dz 4 pk",
      "12DZ4PK",
      "12dz4",
      "12 dz 4",
      "12 dozen 4 packets",
      "12d 4p",
    ])
      expect(parseQuantity(s)).toBe(148);
    expect(parseQuantity("4pk")).toBe(4);
    expect(parseQuantity("12.5dz")).toBe(150);
    expect(parseQuantity("12.25 dz")).toBe(147);
    expect(parseQuantity("1,000 pk")).toBe(1000);
  });

  it("reads a plain number as dozens", () => {
    expect(parseQuantity("12")).toBe(144);
    expect(parseQuantity("2.5")).toBe(30);
    expect(parseQuantity("0")).toBe(0);
  });

  it("refuses what is not a whole number of packets, or not a quantity", () => {
    for (const s of ["", "abc", "1.5pk", "1.04", "12 dz pk", "-3", "pk"])
      expect(parseQuantity(s)).toBeNull();
  });

  it("writes packets back as text it reads again", () => {
    for (const p of [0, 4, 144, 148, 150]) expect(parseQuantity(quantityText(p) || "0")).toBe(p);
    expect([quantityText(148), quantityText(144), quantityText(4)]).toEqual([
      "12dz 4pk",
      "12",
      "4pk",
    ]);
  });
});
