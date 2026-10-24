-- AlterEnum
ALTER TYPE "StockAdjustmentReason" ADD VALUE 'DAMAGED';

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "expenseDate" DATE NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "warehouseId" TEXT,
    "bikeId" TEXT,
    "tripId" TEXT,
    "staffId" TEXT,
    "paidTo" TEXT,
    "note" TEXT,
    "status" "PostingStatus" NOT NULL DEFAULT 'POSTED',
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "requestId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_tenantId_id_key" ON "ExpenseCategory"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_tenantId_name_key" ON "ExpenseCategory"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Expense_tenantId_expenseDate_idx" ON "Expense"("tenantId", "expenseDate");

-- CreateIndex
CREATE INDEX "Expense_tenantId_categoryId_expenseDate_idx" ON "Expense"("tenantId", "categoryId", "expenseDate");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_tenantId_id_key" ON "Expense"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_tenantId_number_key" ON "Expense"("tenantId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "Expense_tenantId_requestId_key" ON "Expense"("tenantId", "requestId");

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_categoryId_fkey" FOREIGN KEY ("tenantId", "categoryId") REFERENCES "ExpenseCategory"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_warehouseId_fkey" FOREIGN KEY ("tenantId", "warehouseId") REFERENCES "Warehouse"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_bikeId_fkey" FOREIGN KEY ("tenantId", "bikeId") REFERENCES "Bike"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_tripId_fkey" FOREIGN KEY ("tenantId", "tripId") REFERENCES "DeliveryTrip"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_staffId_fkey" FOREIGN KEY ("tenantId", "staffId") REFERENCES "Staff"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: positive amounts, and the default categories for every tenant (SPEC §9).
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_amount_check" CHECK ("amount" > 0);

INSERT INTO "ExpenseCategory" ("id", "tenantId", "name", "updatedAt")
SELECT gen_random_uuid()::text, t."id", c.name, now()
FROM "Tenant" t
CROSS JOIN (VALUES ('Rent'), ('Salary'), ('Petrol'), ('Vehicle maintenance'), ('Utilities'),
  ('Loading labour'), ('Tolls'), ('Other')) AS c(name)
ON CONFLICT ("tenantId", "name") DO NOTHING;
