import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

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
