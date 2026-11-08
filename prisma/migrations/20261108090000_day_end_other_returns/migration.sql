-- Day-end: goods from an earlier sale that the customer gives back (any product at an agreed rate,
-- or "Other" for something not in the product list). Credited to the customer for the company.

-- AlterEnum
ALTER TYPE "LedgerEntryType" ADD VALUE 'CUSTOMER_RETURN';

-- CreateTable
CREATE TABLE "CustomerReturn" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT,
    "companyId" TEXT NOT NULL,
    "description" TEXT,
    "quantity" INTEGER NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "bucket" "StockBucket",
    "returnDate" DATE NOT NULL,
    "reversedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerReturn_tenantId_salesOrderId_idx" ON "CustomerReturn"("tenantId", "salesOrderId");

-- CreateIndex
CREATE INDEX "CustomerReturn_tenantId_customerId_returnDate_idx" ON "CustomerReturn"("tenantId", "customerId", "returnDate");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerReturn_tenantId_id_key" ON "CustomerReturn"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "CustomerReturn" ADD CONSTRAINT "CustomerReturn_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReturn" ADD CONSTRAINT "CustomerReturn_tenantId_salesOrderId_fkey" FOREIGN KEY ("tenantId", "salesOrderId") REFERENCES "SalesOrder"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReturn" ADD CONSTRAINT "CustomerReturn_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReturn" ADD CONSTRAINT "CustomerReturn_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerReturn" ADD CONSTRAINT "CustomerReturn_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: a quantity, a rate and an amount; a product has a stock bucket, "Other" has a
-- description and no bucket.
ALTER TABLE "CustomerReturn" ADD CONSTRAINT "CustomerReturn_values_check"
  CHECK ("quantity" > 0 AND "rate" >= 0 AND "amount" >= 0);
ALTER TABLE "CustomerReturn" ADD CONSTRAINT "CustomerReturn_kind_check" CHECK (
  ("productId" IS NOT NULL AND "bucket" IS NOT NULL)
  OR ("productId" IS NULL AND "bucket" IS NULL AND "description" IS NOT NULL)
);
