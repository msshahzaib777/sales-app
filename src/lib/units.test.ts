import { describe, expect, it } from "vitest";

import { dozensToPackets, formatDozens, splitPackets } from "./units";

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
