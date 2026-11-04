-- Expenses we pay for a company (its order booker's salary, other company expenses) are charged
-- back to the company as a claim, deducted on its next bill.

-- AlterEnum
ALTER TYPE "ClaimType" ADD VALUE 'BOOKER_SALARY';
ALTER TYPE "ClaimType" ADD VALUE 'COMPANY_EXPENSE';

-- AlterTable
ALTER TABLE "CompanyClaim" ADD COLUMN "expenseId" TEXT;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN "companyId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CompanyClaim_tenantId_expenseId_key" ON "CompanyClaim"("tenantId", "expenseId");

-- CreateIndex
CREATE INDEX "Expense_tenantId_companyId_idx" ON "Expense"("tenantId", "companyId");

-- AddForeignKey
ALTER TABLE "CompanyClaim" ADD CONSTRAINT "CompanyClaim_tenantId_expenseId_fkey" FOREIGN KEY ("tenantId", "expenseId") REFERENCES "Expense"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_companyId_fkey" FOREIGN KEY ("tenantId", "companyId") REFERENCES "Company"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
