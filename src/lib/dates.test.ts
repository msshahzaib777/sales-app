import { describe, expect, it } from "vitest";

import { businessToday, formatDate, periodRange, toDateInput } from "./dates";

describe("dates", () => {
  it("uses the Pakistan date, not the UTC date", () => {
    // 20:00 UTC on the 23rd is already 01:00 on the 24th in PKT.
    expect(toDateInput(businessToday(undefined, new Date("2026-10-23T20:00:00Z")))).toBe(
      "2026-10-24",
    );
  });

  it("formats business dates", () => {
    expect(formatDate(new Date("2026-10-24T00:00:00Z"))).toBe("24 Oct 2026");
  });
});

describe("periodRange", () => {
  const today = new Date("2026-10-24T00:00:00.000Z"); // a Saturday
  const iso = (r: { from: Date; to: Date }) => [toDateInput(r.from), toDateInput(r.to)];

  it("gives weeks from Monday to Sunday", () => {
    expect(iso(periodRange("this-week", today))).toEqual(["2026-10-19", "2026-10-25"]);
    expect(iso(periodRange("last-week", today))).toEqual(["2026-10-12", "2026-10-18"]);
    expect(iso(periodRange("this-week", new Date("2026-10-19T00:00:00.000Z")))).toEqual([
      "2026-10-19",
      "2026-10-25",
    ]);
  });

  it("gives whole calendar months", () => {
    expect(iso(periodRange("this-month", today))).toEqual(["2026-10-01", "2026-10-31"]);
    expect(iso(periodRange("last-month", new Date("2026-01-15T00:00:00.000Z")))).toEqual([
      "2025-12-01",
      "2025-12-31",
    ]);
  });
});
