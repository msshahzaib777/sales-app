
-- CreateEnum
CREATE TYPE "CompanyBillKind" AS ENUM ('GOODS_RECEIPT', 'OPENING_BALANCE');

-- AlterTable
ALTER TABLE "CompanyBill" ADD COLUMN     "kind" "CompanyBillKind" NOT NULL DEFAULT 'GOODS_RECEIPT',
ALTER COLUMN "goodsReceiptId" DROP NOT NULL;


-- Hand-written: only the opening-balance bill has no goods receipt, and each company has at most one.
ALTER TABLE "CompanyBill" ADD CONSTRAINT "CompanyBill_kind_check" CHECK (
  ("kind" = 'GOODS_RECEIPT' AND "goodsReceiptId" IS NOT NULL)
  OR ("kind" = 'OPENING_BALANCE' AND "goodsReceiptId" IS NULL)
);
CREATE UNIQUE INDEX "CompanyBill_opening_balance_key" ON "CompanyBill"("tenantId", "companyId") WHERE "kind" = 'OPENING_BALANCE';

-- Backfill: an opening-balance bill for every company that has a positive opening balance, so
-- payments can be applied to it. Numbers continue each tenant's company-bill sequence.
WITH openings AS (
  SELECT "tenantId", "companyId", SUM("credit" - "debit") AS amount, MIN("entryDate") AS opened
  FROM "LedgerEntry"
  WHERE "partyType" = 'COMPANY' AND "type" = 'OPENING_BALANCE'
  GROUP BY "tenantId", "companyId"
  HAVING SUM("credit" - "debit") > 0
),
numbered AS (
  SELECT o.*,
    GREATEST(
      COALESCE((SELECT s."nextValue" FROM "DocumentSequence" s WHERE s."tenantId" = o."tenantId" AND s."key" = 'COMPANY_BILL'), 1),
      COALESCE((SELECT MAX(b."number") + 1 FROM "CompanyBill" b WHERE b."tenantId" = o."tenantId"), 1)
    ) - 1 + ROW_NUMBER() OVER (PARTITION BY o."tenantId" ORDER BY o."companyId") AS number
  FROM openings o
)
INSERT INTO "CompanyBill" ("id", "tenantId", "number", "companyId", "kind", "billDate", "dueDate", "grossAmount", "claimDeduction", "netAmount", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, n."tenantId", n.number, n."companyId", 'OPENING_BALANCE', n.opened, n.opened, n.amount, 0, n.amount, 'POSTED', now(), now()
FROM numbered n;

INSERT INTO "DocumentSequence" ("tenantId", "key", "nextValue")
SELECT "tenantId", 'COMPANY_BILL', MAX("number") + 1 FROM "CompanyBill" GROUP BY "tenantId"
ON CONFLICT ("tenantId", "key") DO UPDATE SET "nextValue" = GREATEST("DocumentSequence"."nextValue", EXCLUDED."nextValue");
