-- CreateEnum
CREATE TYPE "OrderFulfilment" AS ENUM ('DELIVERY', 'COUNTER');

-- AlterTable: every existing order is a delivery.
ALTER TABLE "SalesOrder" ADD COLUMN "fulfilment" "OrderFulfilment" NOT NULL DEFAULT 'DELIVERY';

-- CreateIndex
CREATE INDEX "SalesOrder_tenantId_fulfilment_orderDate_idx" ON "SalesOrder"("tenantId", "fulfilment", "orderDate");
