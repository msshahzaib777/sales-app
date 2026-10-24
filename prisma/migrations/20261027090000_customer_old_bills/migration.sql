-- CreateTable
CREATE TABLE "CustomerOldBill" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "billDate" DATE NOT NULL,
    "billNo" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "status" "PostingStatus" NOT NULL DEFAULT 'POSTED',
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "requestId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerOldBill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerOldBill_tenantId_customerId_billDate_idx" ON "CustomerOldBill"("tenantId", "customerId", "billDate");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOldBill_tenantId_id_key" ON "CustomerOldBill"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOldBill_tenantId_requestId_key" ON "CustomerOldBill"("tenantId", "requestId");

-- AddForeignKey
ALTER TABLE "CustomerOldBill" ADD CONSTRAINT "CustomerOldBill_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOldBill" ADD CONSTRAINT "CustomerOldBill_tenantId_customerId_fkey" FOREIGN KEY ("tenantId", "customerId") REFERENCES "Customer"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: positive amounts.
ALTER TABLE "CustomerOldBill" ADD CONSTRAINT "CustomerOldBill_amount_check" CHECK ("amount" > 0);

-- Hand-written: customer ledger entries carry companyId (CLAUDE.md rule 3), except the customer's
-- old balance (paper bills from before the app, owed to us and not to a company): its opening
-- entry, the payments that settle it, a bounced cheque or reversal of those payments.
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_party_check";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_party_check" CHECK (
  ("partyType" = 'CUSTOMER' AND "customerId" IS NOT NULL AND "staffId" IS NULL
    AND ("companyId" IS NOT NULL
      OR "type" IN ('OPENING_BALANCE', 'CUSTOMER_PAYMENT', 'CHEQUE_BOUNCE', 'REVERSAL')))
  OR ("partyType" = 'COMPANY' AND "companyId" IS NOT NULL AND "customerId" IS NULL AND "staffId" IS NULL)
  OR ("partyType" = 'STAFF' AND "staffId" IS NOT NULL AND "customerId" IS NULL AND "companyId" IS NULL)
);
