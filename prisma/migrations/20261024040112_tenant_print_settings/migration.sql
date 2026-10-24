
-- CreateEnum
CREATE TYPE "PaperSize" AS ENUM ('A4', 'A5', 'HALF_A4', 'A6', 'CUSTOM');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "billPaper" "PaperSize" NOT NULL DEFAULT 'A5',
ADD COLUMN     "billPaperHeightMm" INTEGER,
ADD COLUMN     "billPaperWidthMm" INTEGER,
ADD COLUMN     "printFontSizePt" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "printMarginMm" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "twoBillsPerA4" BOOLEAN NOT NULL DEFAULT false;


-- Hand-written: sensible bounds for print settings.
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_print_check" CHECK (
  "printMarginMm" BETWEEN 0 AND 30
  AND "printFontSizePt" BETWEEN 7 AND 16
  AND ("billPaper" <> 'CUSTOM' OR ("billPaperWidthMm" BETWEEN 50 AND 300 AND "billPaperHeightMm" BETWEEN 50 AND 420))
);
