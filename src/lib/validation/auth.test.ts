import { describe, expect, it } from "vitest";

import { changePasswordSchema, emailSchema, newPasswordSchema } from "./auth";

describe("auth validation", () => {
  it("normalises emails", () => {
    expect(emailSchema.parse("  Owner@Demo.TEST ")).toBe("owner@demo.test");
    expect(emailSchema.safeParse("not-an-email").success).toBe(false);
  });

  it("requires strong passwords", () => {
    expect(newPasswordSchema.safeParse("short1").success).toBe(false);
    expect(newPasswordSchema.safeParse("onlyletters").success).toBe(false);
    expect(newPasswordSchema.safeParse("12345678").success).toBe(false);
    expect(newPasswordSchema.safeParse("Karachi2026").success).toBe(true);
  });

  it("checks the confirmation and that the password changes", () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "Old12345",
        newPassword: "New12345",
        confirmPassword: "New1234",
      }).success,
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "Same1234",
        newPassword: "Same1234",
        confirmPassword: "Same1234",
      }).success,
    ).toBe(false);
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "Old12345",
        newPassword: "New12345",
        confirmPassword: "New12345",
      }).success,
    ).toBe(true);
  });
});
