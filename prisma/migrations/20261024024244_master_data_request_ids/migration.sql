
-- AlterTable
ALTER TABLE "Area" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "Bike" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "requestId" TEXT;

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "requestId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Area_tenantId_requestId_key" ON "Area"("tenantId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Bike_tenantId_requestId_key" ON "Bike"("tenantId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_tenantId_requestId_key" ON "Company"("tenantId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_requestId_key" ON "Customer"("tenantId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_requestId_key" ON "Product"("tenantId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_tenantId_requestId_key" ON "Staff"("tenantId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_tenantId_requestId_key" ON "Warehouse"("tenantId", "requestId");

