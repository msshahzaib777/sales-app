import { describe, expect, it } from "vitest";

import { assertCan, can, ForbiddenError, PERMISSIONS } from "./permissions";

describe("permissions", () => {
  it("gives the owner everything", () => {
    for (const permission of PERMISSIONS) expect(can("OWNER", permission)).toBe(true);
  });

  it("never lets staff see profit, margin or purchase cost", () => {
    expect(can("STAFF", "financials.view")).toBe(false);
    expect(can("STAFF", "ledgers.view")).toBe(false);
    expect(can("STAFF", "rates.manage")).toBe(false);
  });

  it("lets staff do daily operations and only request stock adjustments", () => {
    expect(can("STAFF", "operations.manage")).toBe(true);
    expect(can("STAFF", "stock.requestAdjustment")).toBe(true);
    expect(can("STAFF", "stock.approveAdjustment")).toBe(false);
  });

  it("keeps user management and approvals with the owner", () => {
    for (const role of ["ACCOUNTANT", "STAFF"] as const) {
      expect(can(role, "users.manage")).toBe(false);
      expect(can(role, "stock.approveAdjustment")).toBe(false);
      expect(can(role, "orders.overrideCreditLimit")).toBe(false);
    }
  });

  it("gives the accountant money and financial reports", () => {
    expect(can("ACCOUNTANT", "payments.manage")).toBe(true);
    expect(can("ACCOUNTANT", "financials.view")).toBe(true);
    expect(can("ACCOUNTANT", "expenses.manage")).toBe(true);
  });

  it("gives the platform super admin no tenant permissions", () => {
    for (const permission of PERMISSIONS) expect(can("SUPER_ADMIN", permission)).toBe(false);
  });

  it("assertCan throws ForbiddenError", () => {
    expect(() => assertCan("STAFF", "users.manage")).toThrow(ForbiddenError);
    expect(() => assertCan("OWNER", "users.manage")).not.toThrow();
  });
});
