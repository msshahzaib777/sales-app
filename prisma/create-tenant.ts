import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { createTenantWithOwner } from "../src/server/platform/create-tenant";

// Usage: pnpm tenant:create "Business name" "Owner name" owner@example.com
// Prints a one-time password; the owner must change it at first sign-in.

async function main() {
  const [name, ownerName, ownerEmail] = process.argv.slice(2);
  if (!name || !ownerName || !ownerEmail) {
    console.error('Usage: pnpm tenant:create "Business name" "Owner name" owner@example.com');
    process.exit(1);
  }
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const { tenant, owner, temporaryPassword } = await createTenantWithOwner(prisma, {
      name,
      ownerName,
      ownerEmail,
    });
    console.log(`Created ${tenant.name} (${tenant.slug}).`);
    console.log(`Owner login: ${owner.email}`);
    console.log(`One-time password: ${temporaryPassword} (must be changed at first sign-in)`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
