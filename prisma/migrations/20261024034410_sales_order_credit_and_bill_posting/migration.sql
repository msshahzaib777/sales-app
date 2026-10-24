
-- AlterTable
ALTER TABLE "Bill" ADD COLUMN     "postedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "needsCreditApproval" BOOLEAN NOT NULL DEFAULT false;

