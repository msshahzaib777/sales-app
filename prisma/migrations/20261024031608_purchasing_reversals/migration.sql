
-- AlterTable
ALTER TABLE "CompanyClaim" ADD COLUMN     "reversedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CompanyPayment" ADD COLUMN     "reversalReason" TEXT;

-- AlterTable
ALTER TABLE "GoodsReceipt" ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "status" "PostingStatus" NOT NULL DEFAULT 'POSTED';

