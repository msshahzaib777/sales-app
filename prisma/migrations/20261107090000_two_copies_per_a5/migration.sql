-- AlterTable: print each bill twice on one A5 sheet.
ALTER TABLE "Tenant" ADD COLUMN "twoCopiesPerA5" BOOLEAN NOT NULL DEFAULT false;
