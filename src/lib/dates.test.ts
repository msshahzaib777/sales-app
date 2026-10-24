import { describe, expect, it } from "vitest";

import { businessToday, formatDate, toDateInput } from "./dates";

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
