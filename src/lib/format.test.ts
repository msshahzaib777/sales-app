import { describe, expect, it } from "vitest";

import { formatDateTime } from "./format";

describe("formatDateTime", () => {
  it("shows Pakistan time by default", () => {
    // 21:30 UTC is 02:30 the next day in PKT (UTC+5).
    expect(formatDateTime(new Date("2026-10-24T21:30:00Z"))).toBe("25 Oct 2026, 2:30 am");
  });
});
