-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNED', 'DISPATCHED', 'RECONCILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "reconcileRequestId" TEXT,
ADD COLUMN     "reconciledAt" TIMESTAMP(3),
ADD COLUMN     "reconciledById" TEXT,
ADD COLUMN     "tripId" TEXT;

-- AlterTable
ALTER TABLE "SalesOrderLine" ADD COLUMN     "damagedQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "returnedQuantity" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "DeliveryTrip" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "tripDate" DATE NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "bikeId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNED',
    "dispatchedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "note" TEXT,
    "requestId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryTrip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryTrip_tenantId_tripDate_idx" ON "DeliveryTrip"("tenantId", "tripDate");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryTrip_tenantId_id_key" ON "DeliveryTrip"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryTrip_tenantId_number_key" ON "DeliveryTrip"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryTrip_tenantId_requestId_key" ON "DeliveryTrip"("tenantId", "requestId");

-- CreateIndex
CREATE INDEX "SalesOrder_tenantId_tripId_idx" ON "SalesOrder"("tenantId", "tripId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_tenantId_reconcileRequestId_key" ON "SalesOrder"("tenantId", "reconcileRequestId");

-- AddForeignKey
ALTER TABLE "DeliveryTrip" ADD CONSTRAINT "DeliveryTrip_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTrip" ADD CONSTRAINT "DeliveryTrip_tenantId_warehouseId_fkey" FOREIGN KEY ("tenantId", "warehouseId") REFERENCES "Warehouse"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTrip" ADD CONSTRAINT "DeliveryTrip_tenantId_bikeId_fkey" FOREIGN KEY ("tenantId", "bikeId") REFERENCES "Bike"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryTrip" ADD CONSTRAINT "DeliveryTrip_tenantId_driverId_fkey" FOREIGN KEY ("tenantId", "driverId") REFERENCES "Staff"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_tenantId_tripId_fkey" FOREIGN KEY ("tenantId", "tripId") REFERENCES "DeliveryTrip"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Day-end quantities: never negative, and never more than was ordered.
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_delivery_check"
  CHECK ("returnedQuantity" >= 0 AND "damagedQuantity" >= 0
         AND "returnedQuantity" + "damagedQuantity" <= "quantity");

-- Bill: each company's "previous pending", frozen when the bill is posted at dispatch.
ALTER TABLE "Bill" ADD COLUMN "previousByCompany" JSONB;
