-- Hand-written: the base unit changes from half dozen to packet (12 packets = 1 dozen, so one half
-- dozen = 6 packets), so damage and returns can be counted in packets (owner's change list, item 6).
-- Every stored quantity is multiplied by 6. Rates stay per dozen.
--
-- StockMovement, ProductPriceHistory and BillRevision are append-only (trigger). This one-time
-- change of unit restates their quantities without changing what they mean, so the triggers are
-- switched off for it and back on at the end, inside this migration's transaction.

ALTER TABLE "StockMovement" DISABLE TRIGGER "StockMovement_append_only";
ALTER TABLE "ProductPriceHistory" DISABLE TRIGGER "ProductPriceHistory_append_only";
ALTER TABLE "BillRevision" DISABLE TRIGGER "BillRevision_append_only";

UPDATE "Product" SET "minStockLevel" = "minStockLevel" * 6;
UPDATE "ProductDiscountTier" SET "minQuantity" = "minQuantity" * 6;
UPDATE "Bike" SET "capacity" = "capacity" * 6;
UPDATE "PurchaseOrderLine" SET "quantity" = "quantity" * 6;
UPDATE "GoodsReceiptLine" SET "quantity" = "quantity" * 6;
UPDATE "CompanyClaim" SET "quantity" = "quantity" * 6;
UPDATE "StockMovement" SET "quantity" = "quantity" * 6;
UPDATE "StockAdjustment" SET "quantity" = "quantity" * 6;
UPDATE "SalesOrderLine" SET
  "quantity" = "quantity" * 6,
  "returnedQuantity" = "returnedQuantity" * 6,
  "damagedQuantity" = "damagedQuantity" * 6;

-- Quantities inside JSON snapshots.
UPDATE "ProductPriceHistory" SET "discountTiers" = (
  SELECT COALESCE(jsonb_agg(t || jsonb_build_object('minQuantity', (t->>'minQuantity')::int * 6)), '[]'::jsonb)
  FROM jsonb_array_elements("discountTiers") t
) WHERE jsonb_typeof("discountTiers") = 'array' AND jsonb_array_length("discountTiers") > 0;

UPDATE "BillRevision" SET
  "lines" = (
    SELECT COALESCE(jsonb_agg(l || jsonb_build_object('quantity', (l->>'quantity')::int * 6)), '[]'::jsonb)
    FROM jsonb_array_elements("lines") l
  ),
  "companyTotals" = (
    SELECT COALESCE(jsonb_agg(
      CASE WHEN c ? 'quantity' THEN c || jsonb_build_object('quantity', (c->>'quantity')::int * 6) ELSE c END
    ), '[]'::jsonb)
    FROM jsonb_array_elements("companyTotals") c
  );

ALTER TABLE "StockMovement" ENABLE TRIGGER "StockMovement_append_only";
ALTER TABLE "ProductPriceHistory" ENABLE TRIGGER "ProductPriceHistory_append_only";
ALTER TABLE "BillRevision" ENABLE TRIGGER "BillRevision_append_only";

-- Unit conversions: packet is the base unit now.
UPDATE "UnitConversion" SET "baseUnit" = 'PACKET',
  "baseUnitsPerUnit" = "baseUnitsPerUnit" * 6
WHERE "baseUnit" = 'HALF_DOZEN';
INSERT INTO "UnitConversion" ("id", "tenantId", "productId", "baseUnit", "unit", "baseUnitsPerUnit")
SELECT gen_random_uuid()::text, t."id", NULL, 'PACKET', 'PACKET', 1
FROM "Tenant" t
WHERE EXISTS (SELECT 1 FROM "UnitConversion" u WHERE u."tenantId" = t."id" AND u."baseUnit" = 'PACKET')
  AND NOT EXISTS (
    SELECT 1 FROM "UnitConversion" u
    WHERE u."tenantId" = t."id" AND u."productId" IS NULL AND u."unit" = 'PACKET'
  );
