import { describe, expect, it } from "vitest";

import { dozensToHalfDozens, formatDozens } from "./units";

describe("formatDozens", () => {
  it("shows whole and half dozens", () => {
    expect(formatDozens(0)).toBe("0 dz");
    expect(formatDozens(4)).toBe("2 dz");
    expect(formatDozens(7)).toBe("3.5 dz");
    expect(formatDozens(-3)).toBe("-1.5 dz");
  });

  it("rejects non-integer storage values", () => {
    expect(() => formatDozens(1.5)).toThrow();
  });
});

describe("dozensToHalfDozens", () => {
  it("converts whole and half dozens", () => {
    expect(dozensToHalfDozens(3)).toBe(6);
    expect(dozensToHalfDozens(2.5)).toBe(5);
  });

  it("rejects quantities that are not a multiple of half a dozen", () => {
    expect(() => dozensToHalfDozens(1.25)).toThrow();
  });
});
