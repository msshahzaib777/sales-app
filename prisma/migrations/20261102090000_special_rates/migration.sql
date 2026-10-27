-- AlterTable: a rate changed on one order line keeps the product's normal rate beside it.
ALTER TABLE "SalesOrderLine" ADD COLUMN "standardRate" DECIMAL(14,2),
ADD COLUMN "rateNote" TEXT;
