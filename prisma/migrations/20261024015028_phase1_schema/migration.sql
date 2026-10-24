-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'OWNER', 'ACCOUNTANT', 'STAFF');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'POST', 'REVERSE', 'APPROVE', 'REJECT', 'LOGIN');

-- CreateEnum
CREATE TYPE "CustomerType" AS ENUM ('RETAILER', 'WHOLESALER', 'DEALER', 'BIKE_SUPPLIER');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('DRIVER', 'OFFICE', 'LOADER', 'OTHER');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('NONE', 'PERCENT', 'AMOUNT_PER_UNIT');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('OPEN', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PostingStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('DELIVERY_DAMAGE', 'RETURN_TO_COMPANY', 'OTHER');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('PENDING', 'APPLIED', 'REVERSED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CHEQUE', 'ONLINE');

-- CreateEnum
CREATE TYPE "ChequeStatus" AS ENUM ('PENDING', 'CLEARED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "ChequeDirection" AS ENUM ('RECEIVED', 'ISSUED');

-- CreateEnum
CREATE TYPE "StockBucket" AS ENUM ('SALEABLE', 'DAMAGED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('OPENING', 'GOODS_RECEIPT', 'DISPATCH', 'CUSTOMER_RETURN', 'DELIVERY_DAMAGE', 'RETURN_TO_COMPANY', 'ADJUSTMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "StockAdjustmentReason" AS ENUM ('COUNTING_ERROR', 'THEFT', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SalesOrderStatus" AS ENUM ('BOOKED', 'PLANNED', 'DISPATCHED', 'DELIVERED', 'PARTIALLY_DELIVERED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('OFFICE', 'WHATSAPP', 'BOOKER_APP');

-- CreateEnum
CREATE TYPE "PaymentCollectedVia" AS ENUM ('OFFICE', 'DELIVERY');

-- CreateEnum
CREATE TYPE "LedgerPartyType" AS ENUM ('CUSTOMER', 'COMPANY', 'STAFF');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('OPENING_BALANCE', 'SALES_BILL', 'BILL_REVISION', 'CUSTOMER_PAYMENT', 'CHEQUE_BOUNCE', 'COMPANY_BILL', 'COMPANY_PAYMENT', 'COMPANY_CLAIM', 'ADJUSTMENT', 'REVERSAL');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "address" TEXT,
ADD COLUMN     "defaultBaseUnit" TEXT NOT NULL DEFAULT 'HALF_DOZEN',
ADD COLUMN     "defaultPriceUnit" TEXT NOT NULL DEFAULT 'DOZEN',
ADD COLUMN     "expiryTrackingEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "taxEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "userId" TEXT,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "requestId" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSequence" (
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nextValue" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("tenantId","key")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "orderBookerName" TEXT,
    "orderBookerPhone" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "baseUnit" TEXT NOT NULL DEFAULT 'HALF_DOZEN',
    "priceUnit" TEXT NOT NULL DEFAULT 'DOZEN',
    "purchaseRate" DECIMAL(14,2) NOT NULL,
    "saleRate" DECIMAL(14,2) NOT NULL,
    "discountType" "DiscountType" NOT NULL DEFAULT 'NONE',
    "discountValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "minStockLevel" INTEGER NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPriceHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "purchaseRate" DECIMAL(14,2) NOT NULL,
    "saleRate" DECIMAL(14,2) NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DECIMAL(14,2) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitConversion" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT,
    "baseUnit" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "baseUnitsPerUnit" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Area" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "areaId" TEXT,
    "name" TEXT NOT NULL,
    "shopName" TEXT,
    "type" "CustomerType" NOT NULL DEFAULT 'RETAILER',
    "phone" TEXT,
    "whatsapp" TEXT,
    "address" TEXT,
    "routeSequence" INTEGER,
    "creditLimit" DECIMAL(14,2),
    "isFlagged" BOOLEAN NOT NULL DEFAULT false,
    "flagReason" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bike" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "warehouseId" TEXT,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "driverId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "phone" TEXT,
    "monthlySalary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "joiningDate" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "companyId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "orderDate" DATE NOT NULL,
    "expectedDate" DATE,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "requestId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "purchaseOrderId" TEXT,
    "companyId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "receivedDate" DATE NOT NULL,
    "supplierRef" TEXT,
    "note" TEXT,
    "requestId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoodsReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoodsReceiptLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "purchaseOrderLineId" TEXT,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "GoodsReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyBill" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "companyId" TEXT NOT NULL,
    "goodsReceiptId" TEXT NOT NULL,
    "billDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "claimDeduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "status" "PostingStatus" NOT NULL DEFAULT 'POSTED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentDate" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" TEXT,
    "chequeId" TEXT,
    "status" "PostingStatus" NOT NULL DEFAULT 'POSTED',
    "reversedAt" TIMESTAMP(3),
    "note" TEXT,
    "requestId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyPaymentAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyPaymentId" TEXT NOT NULL,
    "companyBillId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "CompanyPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyClaim" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "ClaimType" NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDING',
    "claimDate" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "salesOrderId" TEXT,
    "appliedToBillId" TEXT,
    "note" TEXT,
    "requestId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "goodsReceiptLineId" TEXT,
    "receivedDate" DATE NOT NULL,
    "batchNo" TEXT,
    "mfgDate" DATE,
    "expiryDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "batchId" TEXT,
    "bucket" "StockBucket" NOT NULL DEFAULT 'SALEABLE',
    "quantity" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "reversalOfId" TEXT,
    "note" TEXT,
    "requestId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "bucket" "StockBucket" NOT NULL DEFAULT 'SALEABLE',
    "quantity" INTEGER NOT NULL,
    "reason" "StockAdjustmentReason" NOT NULL,
    "note" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "customerId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "orderDate" DATE NOT NULL,
    "deliveryDate" DATE NOT NULL,
    "status" "SalesOrderStatus" NOT NULL DEFAULT 'BOOKED',
    "source" "OrderSource" NOT NULL DEFAULT 'OFFICE',
    "creditOverrideById" TEXT,
    "creditOverrideAt" TIMESTAMP(3),
    "note" TEXT,
    "requestId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesOrderLine" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "discountType" "DiscountType" NOT NULL DEFAULT 'NONE',
    "discountValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "SalesOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bill" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "salesOrderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "billDate" DATE NOT NULL,
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "previousBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status" "PostingStatus" NOT NULL DEFAULT 'POSTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillRevision" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "grossAmount" DECIMAL(14,2) NOT NULL,
    "discountAmount" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL,
    "netAmount" DECIMAL(14,2) NOT NULL,
    "lines" JSONB NOT NULL,
    "companyTotals" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cheque" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "direction" "ChequeDirection" NOT NULL,
    "chequeNo" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "chequeDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "ChequeStatus" NOT NULL DEFAULT 'PENDING',
    "clearedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cheque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "customerId" TEXT NOT NULL,
    "paymentDate" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reference" TEXT,
    "chequeId" TEXT,
    "collectedVia" "PaymentCollectedVia" NOT NULL DEFAULT 'OFFICE',
    "salesOrderId" TEXT,
    "status" "PostingStatus" NOT NULL DEFAULT 'POSTED',
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "note" TEXT,
    "requestId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerPaymentId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partyType" "LedgerPartyType" NOT NULL,
    "customerId" TEXT,
    "companyId" TEXT,
    "staffId" TEXT,
    "type" "LedgerEntryType" NOT NULL,
    "entryDate" DATE NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "reversalOfId" TEXT,
    "requestId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_entityType_entityId_idx" ON "AuditLog"("tenantId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_userId_createdAt_idx" ON "AuditLog"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_tenantId_id_key" ON "Warehouse"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_tenantId_name_key" ON "Warehouse"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Company_tenantId_warehouseId_idx" ON "Company"("tenantId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_tenantId_id_key" ON "Company"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Company_tenantId_name_key" ON "Company"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Product_tenantId_name_idx" ON "Product"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_id_key" ON "Product"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_code_key" ON "Product"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_companyId_name_key" ON "Product"("tenantId", "companyId", "name");

-- CreateIndex
CREATE INDEX "ProductPriceHistory_tenantId_productId_effectiveFrom_idx" ON "ProductPriceHistory"("tenantId", "productId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPriceHistory_tenantId_id_key" ON "ProductPriceHistory"("tenantId", "id");

-- CreateIndex
CREATE INDEX "UnitConversion_tenantId_productId_idx" ON "UnitConversion"("tenantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "UnitConversion_tenantId_id_key" ON "UnitConversion"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UnitConversion_tenantId_productId_baseUnit_unit_key" ON "UnitConversion"("tenantId", "productId", "baseUnit", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "Area_tenantId_id_key" ON "Area"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Area_tenantId_warehouseId_name_key" ON "Area"("tenantId", "warehouseId", "name");

-- CreateIndex
CREATE INDEX "Customer_tenantId_areaId_routeSequence_idx" ON "Customer"("tenantId", "areaId", "routeSequence");

-- CreateIndex
CREATE INDEX "Customer_tenantId_name_idx" ON "Customer"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Customer_tenantId_phone_idx" ON "Customer"("tenantId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_id_key" ON "Customer"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Bike_tenantId_id_key" ON "Bike"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Bike_tenantId_name_key" ON "Bike"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_userId_key" ON "Staff"("userId");

-- CreateIndex
CREATE INDEX "Staff_tenantId_role_idx" ON "Staff"("tenantId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_tenantId_id_key" ON "Staff"("tenantId", "id");

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_companyId_orderDate_idx" ON "PurchaseOrder"("tenantId", "companyId", "orderDate");

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_status_idx" ON "PurchaseOrder"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_id_key" ON "PurchaseOrder"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_number_key" ON "PurchaseOrder"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_requestId_key" ON "PurchaseOrder"("tenantId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_tenantId_id_key" ON "PurchaseOrderLine"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrderLine_tenantId_purchaseOrderId_productId_key" ON "PurchaseOrderLine"("tenantId", "purchaseOrderId", "productId");

-- CreateIndex
CREATE INDEX "GoodsReceipt_tenantId_companyId_receivedDate_idx" ON "GoodsReceipt"("tenantId", "companyId", "receivedDate");

-- CreateIndex
CREATE INDEX "GoodsReceipt_tenantId_purchaseOrderId_idx" ON "GoodsReceipt"("tenantId", "purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_tenantId_id_key" ON "GoodsReceipt"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_tenantId_number_key" ON "GoodsReceipt"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceipt_tenantId_requestId_key" ON "GoodsReceipt"("tenantId", "requestId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_tenantId_goodsReceiptId_idx" ON "GoodsReceiptLine"("tenantId", "goodsReceiptId");

-- CreateIndex
CREATE INDEX "GoodsReceiptLine_tenantId_productId_idx" ON "GoodsReceiptLine"("tenantId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "GoodsReceiptLine_tenantId_id_key" ON "GoodsReceiptLine"("tenantId", "id");

-- CreateIndex
CREATE INDEX "CompanyBill_tenantId_companyId_dueDate_idx" ON "CompanyBill"("tenantId", "companyId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyBill_tenantId_id_key" ON "CompanyBill"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyBill_tenantId_number_key" ON "CompanyBill"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyBill_tenantId_goodsReceiptId_key" ON "CompanyBill"("tenantId", "goodsReceiptId");

-- CreateIndex
CREATE INDEX "CompanyPayment_tenantId_companyId_paymentDate_idx" ON "CompanyPayment"("tenantId", "companyId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPayment_tenantId_id_key" ON "CompanyPayment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPayment_tenantId_number_key" ON "CompanyPayment"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPayment_tenantId_requestId_key" ON "CompanyPayment"("tenantId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPayment_tenantId_chequeId_key" ON "CompanyPayment"("tenantId", "chequeId");

-- CreateIndex
CREATE INDEX "CompanyPaymentAllocation_tenantId_companyBillId_idx" ON "CompanyPaymentAllocation"("tenantId", "companyBillId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPaymentAllocation_tenantId_id_key" ON "CompanyPaymentAllocation"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyPaymentAllocation_tenantId_companyPaymentId_companyB_key" ON "CompanyPaymentAllocation"("tenantId", "companyPaymentId", "companyBillId");

-- CreateIndex
CREATE INDEX "CompanyClaim_tenantId_companyId_status_idx" ON "CompanyClaim"("tenantId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyClaim_tenantId_id_key" ON "CompanyClaim"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyClaim_tenantId_number_key" ON "CompanyClaim"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyClaim_tenantId_requestId_key" ON "CompanyClaim"("tenantId", "requestId");

-- CreateIndex
CREATE INDEX "Batch_tenantId_productId_warehouseId_receivedDate_idx" ON "Batch"("tenantId", "productId", "warehouseId", "receivedDate");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_tenantId_id_key" ON "Batch"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Batch_tenantId_goodsReceiptLineId_key" ON "Batch"("tenantId", "goodsReceiptLineId");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_productId_warehouseId_bucket_idx" ON "StockMovement"("tenantId", "productId", "warehouseId", "bucket");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_batchId_idx" ON "StockMovement"("tenantId", "batchId");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_referenceType_referenceId_idx" ON "StockMovement"("tenantId", "referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_occurredAt_idx" ON "StockMovement"("tenantId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_tenantId_id_key" ON "StockMovement"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_tenantId_reversalOfId_key" ON "StockMovement"("tenantId", "reversalOfId");

-- CreateIndex
CREATE INDEX "StockAdjustment_tenantId_status_idx" ON "StockAdjustment"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_tenantId_id_key" ON "StockAdjustment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustment_tenantId_requestId_key" ON "StockAdjustment"("tenantId", "requestId");

-- CreateIndex
CREATE INDEX "SalesOrder_tenantId_status_deliveryDate_idx" ON "SalesOrder"("tenantId", "status", "deliveryDate");

-- CreateIndex
CREATE INDEX "SalesOrder_tenantId_customerId_orderDate_idx" ON "SalesOrder"("tenantId", "customerId", "orderDate");

-- CreateIndex
CREATE INDEX "SalesOrder_tenantId_deliveryDate_idx" ON "SalesOrder"("tenantId", "deliveryDate");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_tenantId_id_key" ON "SalesOrder"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_tenantId_number_key" ON "SalesOrder"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_tenantId_requestId_key" ON "SalesOrder"("tenantId", "requestId");

-- CreateIndex
CREATE INDEX "SalesOrderLine_tenantId_productId_idx" ON "SalesOrderLine"("tenantId", "productId");

-- CreateIndex
CREATE INDEX "SalesOrderLine_tenantId_companyId_idx" ON "SalesOrderLine"("tenantId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderLine_tenantId_id_key" ON "SalesOrderLine"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrderLine_tenantId_salesOrderId_productId_key" ON "SalesOrderLine"("tenantId", "salesOrderId", "productId");

-- CreateIndex
CREATE INDEX "Bill_tenantId_customerId_billDate_idx" ON "Bill"("tenantId", "customerId", "billDate");

-- CreateIndex
CREATE INDEX "Bill_tenantId_billDate_idx" ON "Bill"("tenantId", "billDate");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_tenantId_id_key" ON "Bill"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_tenantId_number_key" ON "Bill"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_tenantId_salesOrderId_key" ON "Bill"("tenantId", "salesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "BillRevision_tenantId_id_key" ON "BillRevision"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "BillRevision_tenantId_billId_revision_key" ON "BillRevision"("tenantId", "billId", "revision");

-- CreateIndex
CREATE INDEX "Cheque_tenantId_status_chequeDate_idx" ON "Cheque"("tenantId", "status", "chequeDate");

-- CreateIndex
CREATE UNIQUE INDEX "Cheque_tenantId_id_key" ON "Cheque"("tenantId", "id");

-- CreateIndex
CREATE INDEX "CustomerPayment_tenantId_customerId_paymentDate_idx" ON "CustomerPayment"("tenantId", "customerId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPayment_tenantId_id_key" ON "CustomerPayment"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPayment_tenantId_number_key" ON "CustomerPayment"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPayment_tenantId_requestId_key" ON "CustomerPayment"("tenantId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPayment_tenantId_chequeId_key" ON "CustomerPayment"("tenantId", "chequeId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_tenantId_billId_idx" ON "PaymentAllocation"("tenantId", "billId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_tenantId_id_key" ON "PaymentAllocation"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_tenantId_customerPaymentId_billId_company_key" ON "PaymentAllocation"("tenantId", "customerPaymentId", "billId", "companyId");

-- CreateIndex
CREATE INDEX "LedgerEntry_tenantId_partyType_customerId_companyId_entryDa_idx" ON "LedgerEntry"("tenantId", "partyType", "customerId", "companyId", "entryDate");

-- CreateIndex
CREATE INDEX "LedgerEntry_tenantId_partyType_companyId_entryDate_idx" ON "LedgerEntry"("tenantId", "partyType", "companyId", "entryDate");

-- CreateIndex
CREATE INDEX "LedgerEntry_tenantId_partyType_staffId_entryDate_idx" ON "LedgerEntry"("tenantId", "partyType", "staffId", "entryDate");

-- CreateIndex
CREATE INDEX "LedgerEntry_tenantId_referenceType_referenceId_idx" ON "LedgerEntry"("tenantId", "referenceType", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_tenantId_id_key" ON "LedgerEntry"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_tenantId_reversalOfId_key" ON "LedgerEntry"("tenantId", "reversalOfId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSequence" ADD CONSTRAINT "DocumentSequence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_tenantId_warehouseId_fkey" FOREIGN KEY ("tenantId", "warehouseId") REFERENCES "Warehouse"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPriceHistory" ADD CONSTRAINT "ProductPriceHistory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPriceHistory" ADD CONSTRAINT "ProductPriceHistory_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_tenantId_warehouseId_fkey" FOREIGN KEY ("tenantId", "warehouseId") REFERENCES "Warehouse"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_areaId_fkey" FOREIGN KEY ("tenantId", "areaId") REFERENCES "Area"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bike" ADD CONSTRAINT "Bike_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bike" ADD CONSTRAINT "Bike_tenantId_warehouseId_fkey" FOREIGN KEY ("tenantId", "warehouseId") REFERENCES "Warehouse"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bike" ADD CONSTRAINT "Bike_tenantId_driverId_fkey" FOREIGN KEY ("tenantId", "driverId") REFERENCES "Staff"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_warehouseId_fkey" FOREIGN KEY ("tenantId", "warehouseId") REFERENCES "Warehouse"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_tenantId_purchaseOrderId_fkey" FOREIGN KEY ("tenantId", "purchaseOrderId") REFERENCES "PurchaseOrder"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_tenantId_purchaseOrderId_fkey" FOREIGN KEY ("tenantId", "purchaseOrderId") REFERENCES "PurchaseOrder"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceipt" ADD CONSTRAINT "GoodsReceipt_tenantId_warehouseId_fkey" FOREIGN KEY ("tenantId", "warehouseId") REFERENCES "Warehouse"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_tenantId_goodsReceiptId_fkey" FOREIGN KEY ("tenantId", "goodsReceiptId") REFERENCES "GoodsReceipt"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_tenantId_purchaseOrderLineId_fkey" FOREIGN KEY ("tenantId", "purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyBill" ADD CONSTRAINT "CompanyBill_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyBill" ADD CONSTRAINT "CompanyBill_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyBill" ADD CONSTRAINT "CompanyBill_tenantId_goodsReceiptId_fkey" FOREIGN KEY ("tenantId", "goodsReceiptId") REFERENCES "GoodsReceipt"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPayment" ADD CONSTRAINT "CompanyPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPayment" ADD CONSTRAINT "CompanyPayment_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPayment" ADD CONSTRAINT "CompanyPayment_tenantId_chequeId_fkey" FOREIGN KEY ("tenantId", "chequeId") REFERENCES "Cheque"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPaymentAllocation" ADD CONSTRAINT "CompanyPaymentAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPaymentAllocation" ADD CONSTRAINT "CompanyPaymentAllocation_tenantId_companyPaymentId_fkey" FOREIGN KEY ("tenantId", "companyPaymentId") REFERENCES "CompanyPayment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPaymentAllocation" ADD CONSTRAINT "CompanyPaymentAllocation_tenantId_companyBillId_fkey" FOREIGN KEY ("tenantId", "companyBillId") REFERENCES "CompanyBill"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyPaymentAllocation" ADD CONSTRAINT "CompanyPaymentAllocation_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyClaim" ADD CONSTRAINT "CompanyClaim_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyClaim" ADD CONSTRAINT "CompanyClaim_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyClaim" ADD CONSTRAINT "CompanyClaim_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyClaim" ADD CONSTRAINT "CompanyClaim_tenantId_salesOrderId_fkey" FOREIGN KEY ("tenantId", "salesOrderId") REFERENCES "SalesOrder"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyClaim" ADD CONSTRAINT "CompanyClaim_tenantId_appliedToBillId_fkey" FOREIGN KEY ("tenantId", "appliedToBillId") REFERENCES "CompanyBill"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_tenantId_warehouseId_fkey" FOREIGN KEY ("tenantId", "warehouseId") REFERENCES "Warehouse"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_tenantId_goodsReceiptLineId_fkey" FOREIGN KEY ("tenantId", "goodsReceiptLineId") REFERENCES "GoodsReceiptLine"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_warehouseId_fkey" FOREIGN KEY ("tenantId", "warehouseId") REFERENCES "Warehouse"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_batchId_fkey" FOREIGN KEY ("tenantId", "batchId") REFERENCES "Batch"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_reversalOfId_fkey" FOREIGN KEY ("tenantId", "reversalOfId") REFERENCES "StockMovement"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_tenantId_warehouseId_fkey" FOREIGN KEY ("tenantId", "warehouseId") REFERENCES "Warehouse"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_tenantId_warehouseId_fkey" FOREIGN KEY ("tenantId", "warehouseId") REFERENCES "Warehouse"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_tenantId_salesOrderId_fkey" FOREIGN KEY ("tenantId", "salesOrderId") REFERENCES "SalesOrder"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_tenantId_salesOrderId_fkey" FOREIGN KEY ("tenantId", "salesOrderId") REFERENCES "SalesOrder"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillRevision" ADD CONSTRAINT "BillRevision_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillRevision" ADD CONSTRAINT "BillRevision_tenantId_billId_fkey" FOREIGN KEY ("tenantId", "billId") REFERENCES "Bill"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_tenantId_chequeId_fkey" FOREIGN KEY ("tenantId", "chequeId") REFERENCES "Cheque"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_tenantId_salesOrderId_fkey" FOREIGN KEY ("tenantId", "salesOrderId") REFERENCES "SalesOrder"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tenantId_customerPaymentId_fkey" FOREIGN KEY ("tenantId", "customerPaymentId") REFERENCES "CustomerPayment"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tenantId_billId_fkey" FOREIGN KEY ("tenantId", "billId") REFERENCES "Bill"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_tenantId_staffId_fkey" FOREIGN KEY ("tenantId", "staffId") REFERENCES "Staff"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_tenantId_reversalOfId_fkey" FOREIGN KEY ("tenantId", "reversalOfId") REFERENCES "LedgerEntry"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written: integrity rules Prisma cannot express (see docs/PROGRESS.md).
-- ─────────────────────────────────────────────────────────────────────────────

-- Ledger: one-sided, non-negative amounts, and the right party columns per party type.
-- Customer entries must always carry companyId (CLAUDE.md rule 3).
ALTER TABLE "LedgerEntry"
  ADD CONSTRAINT "LedgerEntry_amounts_check"
    CHECK ("debit" >= 0 AND "credit" >= 0 AND ("debit" > 0) <> ("credit" > 0)),
  ADD CONSTRAINT "LedgerEntry_party_check" CHECK (
    ("partyType" = 'CUSTOMER' AND "customerId" IS NOT NULL AND "companyId" IS NOT NULL AND "staffId" IS NULL)
    OR ("partyType" = 'COMPANY' AND "companyId" IS NOT NULL AND "customerId" IS NULL AND "staffId" IS NULL)
    OR ("partyType" = 'STAFF' AND "staffId" IS NOT NULL AND "customerId" IS NULL AND "companyId" IS NULL)
  );

-- Stock: signed, non-zero quantities.
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_quantity_check" CHECK ("quantity" <> 0);
ALTER TABLE "StockAdjustment" ADD CONSTRAINT "StockAdjustment_quantity_check" CHECK ("quantity" <> 0);

-- Document lines: positive quantities, non-negative money.
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_values_check"
  CHECK ("quantity" > 0 AND "rate" >= 0);
ALTER TABLE "GoodsReceiptLine" ADD CONSTRAINT "GoodsReceiptLine_values_check"
  CHECK ("quantity" > 0 AND "rate" >= 0 AND "amount" >= 0);
ALTER TABLE "SalesOrderLine" ADD CONSTRAINT "SalesOrderLine_values_check"
  CHECK ("quantity" > 0 AND "rate" >= 0 AND "discountAmount" >= 0 AND "taxAmount" >= 0 AND "netAmount" >= 0);
ALTER TABLE "CompanyClaim" ADD CONSTRAINT "CompanyClaim_values_check"
  CHECK ("quantity" > 0 AND "rate" >= 0 AND "amount" >= 0);

-- Payments and allocations.
ALTER TABLE "CustomerPayment" ADD CONSTRAINT "CustomerPayment_amount_check" CHECK ("amount" > 0);
ALTER TABLE "CompanyPayment" ADD CONSTRAINT "CompanyPayment_amount_check" CHECK ("amount" > 0);
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_amount_check" CHECK ("amount" > 0);
ALTER TABLE "CompanyPaymentAllocation" ADD CONSTRAINT "CompanyPaymentAllocation_amount_check" CHECK ("amount" > 0);
ALTER TABLE "Cheque" ADD CONSTRAINT "Cheque_amount_check" CHECK ("amount" > 0);

-- Master data.
ALTER TABLE "Product" ADD CONSTRAINT "Product_values_check" CHECK (
  "purchaseRate" >= 0 AND "saleRate" >= 0 AND "minStockLevel" >= 0 AND "discountValue" >= 0
  AND ("discountType" <> 'PERCENT' OR "discountValue" <= 100)
);
ALTER TABLE "Bike" ADD CONSTRAINT "Bike_capacity_check" CHECK ("capacity" > 0);
ALTER TABLE "UnitConversion" ADD CONSTRAINT "UnitConversion_factor_check" CHECK ("baseUnitsPerUnit" > 0);
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_creditLimit_check" CHECK ("creditLimit" IS NULL OR "creditLimit" >= 0);

-- Unit conversions: Postgres treats NULLs as distinct in unique indexes, so add a separate
-- unique index for tenant-wide defaults (productId IS NULL).
CREATE UNIQUE INDEX "UnitConversion_tenant_default_key"
  ON "UnitConversion"("tenantId", "baseUnit", "unit") WHERE "productId" IS NULL;

-- Append-only journals (CLAUDE.md rule 2, SPEC §13 audit): block UPDATE, DELETE and TRUNCATE.
-- Corrections are new reversal rows. `prisma migrate reset` drops the schema, so dev resets still work.
CREATE FUNCTION "prevent_append_only_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed; post a reversal instead', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "StockMovement_append_only" BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_change"();
CREATE TRIGGER "StockMovement_no_truncate" BEFORE TRUNCATE ON "StockMovement"
  FOR EACH STATEMENT EXECUTE FUNCTION "prevent_append_only_change"();

CREATE TRIGGER "LedgerEntry_append_only" BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_change"();
CREATE TRIGGER "LedgerEntry_no_truncate" BEFORE TRUNCATE ON "LedgerEntry"
  FOR EACH STATEMENT EXECUTE FUNCTION "prevent_append_only_change"();

CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_change"();
CREATE TRIGGER "AuditLog_no_truncate" BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION "prevent_append_only_change"();

CREATE TRIGGER "ProductPriceHistory_append_only" BEFORE UPDATE OR DELETE ON "ProductPriceHistory"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_change"();
CREATE TRIGGER "ProductPriceHistory_no_truncate" BEFORE TRUNCATE ON "ProductPriceHistory"
  FOR EACH STATEMENT EXECUTE FUNCTION "prevent_append_only_change"();

CREATE TRIGGER "BillRevision_append_only" BEFORE UPDATE OR DELETE ON "BillRevision"
  FOR EACH ROW EXECUTE FUNCTION "prevent_append_only_change"();
CREATE TRIGGER "BillRevision_no_truncate" BEFORE TRUNCATE ON "BillRevision"
  FOR EACH STATEMENT EXECUTE FUNCTION "prevent_append_only_change"();
