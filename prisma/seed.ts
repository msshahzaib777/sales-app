import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

// Demo data seed. Task 1 only creates the demo tenant; Task 2 extends this with
// 2 warehouses, 3 companies, 20 products, 30 customers and 4 bikes (see CLAUDE.md).

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: "demo" },
    update: {},
    create: { name: "Demo Snacks Distributor", slug: "demo" },
  });
  console.log(`Seeded tenant: ${tenant.name} (${tenant.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
