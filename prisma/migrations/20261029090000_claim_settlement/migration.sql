-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ClaimStatus" ADD VALUE 'AWAITING';
ALTER TYPE "ClaimStatus" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "CompanyClaim" ADD COLUMN     "claimedAmount" DECIMAL(14,2),
ADD COLUMN     "settledAt" TIMESTAMP(3),
ADD COLUMN     "settledById" TEXT,
ADD COLUMN     "settlementNote" TEXT;


-- Hand-written: existing claims were valued in full when logged.
UPDATE "CompanyClaim" SET "claimedAmount" = "amount";
