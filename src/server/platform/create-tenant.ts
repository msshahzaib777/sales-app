import { z } from "zod";

import type { PrismaClient } from "@/generated/prisma/client";
import { emailSchema } from "@/lib/validation/auth";

import { writeAudit } from "../audit";
import { generateTemporaryPassword, hashPassword } from "../auth/password";

// Creates a real tenant and its owner login (platform level, so the raw client). Until the super
// admin panel (Phase 5), this is how a distributor is set up: `pnpm tenant:create`.

export const createTenantSchema = z.object({
  name: z.string().trim().min(2, "Enter the business name").max(120),
  ownerName: z.string().trim().min(2, "Enter the owner's name").max(80),
  ownerEmail: emailSchema,
});

/** "Al-Madina Traders" → "al-madina-traders" (made unique with a suffix when taken). */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "tenant"
  );
}

export async function createTenantWithOwner(prisma: PrismaClient, input: unknown) {
  const data = createTenantSchema.parse(input);
  const password = generateTemporaryPassword();
  const passwordHash = await hashPassword(password);
  return prisma.$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email: data.ownerEmail } }))
      throw new Error(`A user with ${data.ownerEmail} already exists.`);
    const base = slugify(data.name);
    let slug = base;
    for (let i = 2; await tx.tenant.findUnique({ where: { slug } }); i++) slug = `${base}-${i}`;

    const tenant = await tx.tenant.create({ data: { name: data.name, slug } });
    const owner = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: data.ownerEmail,
        name: data.ownerName,
        role: "OWNER",
        passwordHash,
        mustChangePassword: true,
      },
    });
    // Snacks: half dozen is the base unit, rates are per dozen (CLAUDE.md rule 4).
    await tx.unitConversion.createMany({
      data: [
        { tenantId: tenant.id, baseUnit: "HALF_DOZEN", unit: "HALF_DOZEN", baseUnitsPerUnit: 1 },
        { tenantId: tenant.id, baseUnit: "HALF_DOZEN", unit: "DOZEN", baseUnitsPerUnit: 2 },
      ],
    });
    await writeAudit(tx, owner, {
      action: "CREATE",
      entityType: "Tenant",
      entityId: tenant.id,
      newValue: { name: tenant.name, slug, owner: data.ownerEmail },
      tenantId: tenant.id,
    });
    return { tenant, owner, temporaryPassword: password };
  });
}
