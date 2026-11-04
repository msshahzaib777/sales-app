-- AlterTable: a product's short name, printed on bills when set.
ALTER TABLE "Product" ADD COLUMN "shortName" TEXT;

-- AlterTable: the short bill layout for small paper.
ALTER TABLE "Tenant" ADD COLUMN "compactBills" BOOLEAN NOT NULL DEFAULT false;
