import { describe, expect, it } from "vitest";

import { changePct, periodLabel, periodOf, shiftPeriod, trendOf } from "./analysis";
import { toDateInput } from "./dates";

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const iso = (r: { from: Date; to: Date }) => [toDateInput(r.from), toDateInput(r.to)];

describe("periods", () => {
  it("finds the week, month and quarter of a date", () => {
    expect(iso(periodOf("week", day("2026-10-25")))).toEqual(["2026-10-19", "2026-10-25"]);
    expect(iso(periodOf("month", day("2026-10-25")))).toEqual(["2026-10-01", "2026-10-31"]);
    expect(iso(periodOf("quarter", day("2026-11-05")))).toEqual(["2026-10-01", "2026-12-31"]);
    expect(iso(periodOf("month", day("2028-02-10")))).toEqual(["2028-02-01", "2028-02-29"]);
  });

  it("steps back and forward, across years", () => {
    expect(iso(shiftPeriod("week", day("2026-10-25"), -1))).toEqual(["2026-10-12", "2026-10-18"]);
    expect(iso(shiftPeriod("month", day("2026-01-31"), -1))).toEqual(["2025-12-01", "2025-12-31"]);
    expect(iso(shiftPeriod("quarter", day("2026-02-01"), -1))).toEqual([
      "2025-10-01",
      "2025-12-31",
    ]);
    expect(iso(shiftPeriod("month", day("2026-12-15"), 1))).toEqual(["2027-01-01", "2027-01-31"]);
  });

  it("names periods", () => {
    expect(periodLabel("month", periodOf("month", day("2026-10-25")))).toBe("Oct 2026");
    expect(periodLabel("quarter", periodOf("quarter", day("2026-10-25")))).toBe("Q4 2026");
    expect(periodLabel("week", periodOf("week", day("2026-10-25")))).toBe("Week of 19 Oct");
  });
});

describe("trends", () => {
  it("labels the change between two periods", () => {
    expect(changePct(120, 100)).toBe(20);
    expect(changePct(5, 0)).toBeNull();
    expect(trendOf(130, 100)).toBe("RISING");
    expect(trendOf(70, 100)).toBe("DECLINING");
    expect(trendOf(110, 100)).toBe("STEADY");
    expect(trendOf(10, 0)).toBe("NEW");
    expect(trendOf(0, 10)).toBe("STOPPED");
    expect(trendOf(0, 0)).toBe("NONE");
  });
});
