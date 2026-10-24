import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyPassword } from "../auth/password";
import { prisma } from "../db/client";
import { createTenantWithOwner, slugify } from "./create-tenant";

describe("creating a tenant with its owner", () => {
  it("creates the tenant, an owner who must change the one-time password, units and an audit row", async () => {
    const email = `owner-${randomUUID().slice(0, 8)}@example.com`;
    const { tenant, owner, temporaryPassword } = await createTenantWithOwner(prisma, {
      name: "Al-Madina Traders",
      ownerName: "Bilal",
      ownerEmail: email,
    });
    expect(tenant.slug).toMatch(/^al-madina-traders(-\d+)?$/);
    expect([owner.role, owner.tenantId, owner.mustChangePassword]).toEqual([
      "OWNER",
      tenant.id,
      true,
    ]);
    expect(await verifyPassword(temporaryPassword, owner.passwordHash)).toBe(true);
    expect(await prisma.unitConversion.count({ where: { tenantId: tenant.id } })).toBe(3);
    expect(
      await prisma.auditLog.count({ where: { tenantId: tenant.id, entityType: "Tenant" } }),
    ).toBe(1);

    // Same name again: a new slug. Same email again: refused.
    const second = await createTenantWithOwner(prisma, {
      name: "Al-Madina Traders",
      ownerName: "Other",
      ownerEmail: `other-${randomUUID().slice(0, 8)}@example.com`,
    });
    expect(second.tenant.slug).not.toBe(tenant.slug);
    await expect(
      createTenantWithOwner(prisma, { name: "X Traders", ownerName: "Bilal", ownerEmail: email }),
    ).rejects.toThrow(/already exists/);
  });

  it("makes readable slugs", () => {
    expect(slugify("  Al-Madina   Traders (Pvt) ")).toBe("al-madina-traders-pvt");
    expect(slugify("کراچی")).toBe("tenant");
  });
});
