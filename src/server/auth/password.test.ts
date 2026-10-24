import { describe, expect, it } from "vitest";

import { generateTemporaryPassword, hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("Demo@12345");
    expect(stored.startsWith("scrypt$")).toBe(true);
    await expect(verifyPassword("Demo@12345", stored)).resolves.toBe(true);
    await expect(verifyPassword("demo@12345", stored)).resolves.toBe(false);
  });

  it("uses a fresh salt each time", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects malformed hashes", async () => {
    await expect(verifyPassword("x", "bcrypt$abc")).resolves.toBe(false);
  });
});

describe("generateTemporaryPassword", () => {
  it("meets the password policy and is different every time", async () => {
    const { newPasswordSchema } = await import("@/lib/validation/auth");
    const passwords = new Set(Array.from({ length: 50 }, () => generateTemporaryPassword()));
    expect(passwords.size).toBe(50);
    for (const p of passwords) {
      expect(p).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
      expect(newPasswordSchema.safeParse(p).success).toBe(true);
    }
  });
});
