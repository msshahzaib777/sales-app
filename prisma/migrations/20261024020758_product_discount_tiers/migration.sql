-- AlterTable
ALTER TABLE "ProductPriceHistory" ADD COLUMN     "discountTiers" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "ProductDiscountTier" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "minQuantity" INTEGER NOT NULL,
    "discountType" "DiscountType" NOT NULL,
    "discountValue" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductDiscountTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductDiscountTier_tenantId_id_key" ON "ProductDiscountTier"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ProductDiscountTier_tenantId_productId_minQuantity_key" ON "ProductDiscountTier"("tenantId", "productId", "minQuantity");

-- AddForeignKey
ALTER TABLE "ProductDiscountTier" ADD CONSTRAINT "ProductDiscountTier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductDiscountTier" ADD CONSTRAINT "ProductDiscountTier_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: a slab needs a positive threshold and a real discount.
ALTER TABLE "ProductDiscountTier" ADD CONSTRAINT "ProductDiscountTier_values_check" CHECK (
  "minQuantity" > 0 AND "discountType" <> 'NONE' AND "discountValue" >= 0
  AND ("discountType" <> 'PERCENT' OR "discountValue" <= 100)
);
