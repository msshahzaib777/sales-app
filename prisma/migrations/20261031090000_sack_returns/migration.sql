-- AlterEnum
ALTER TYPE "ClaimType" ADD VALUE 'SACK_RETURN';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "sackRate" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN "sacksReceived" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: a sack return has no product.
ALTER TABLE "CompanyClaim" ALTER COLUMN "productId" DROP NOT NULL;
