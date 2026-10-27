-- Phone numbers are stored as "+92 " and the national number without its leading 0
-- (src/lib/phone.ts): "0300-1234567" → "+92 3001234567". Numbers that do not look Pakistani
-- are left as they are.
CREATE FUNCTION "taqseem_pk_phone"(p TEXT) RETURNS TEXT AS $$
DECLARE
  d TEXT;
BEGIN
  IF p IS NULL OR p !~ '^\s*\+?[0-9\s\-().]+$' THEN
    RETURN p;
  END IF;
  d := regexp_replace(p, '\D', '', 'g');
  IF d LIKE '0092%' THEN
    d := substr(d, 5);
  ELSIF d LIKE '92%' AND length(d) >= 11 THEN
    d := substr(d, 3);
  ELSIF d LIKE '0%' THEN
    d := substr(d, 2);
  ELSIF btrim(p) LIKE '+%' THEN
    RETURN p;
  END IF;
  IF d ~ '^[1-9][0-9]{8,10}$' THEN
    RETURN '+92 ' || d;
  END IF;
  RETURN p;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

UPDATE "Tenant" SET "phone" = "taqseem_pk_phone"("phone") WHERE "phone" IS NOT NULL;
UPDATE "Company" SET "phone" = "taqseem_pk_phone"("phone"),
  "orderBookerPhone" = "taqseem_pk_phone"("orderBookerPhone")
  WHERE "phone" IS NOT NULL OR "orderBookerPhone" IS NOT NULL;
UPDATE "Customer" SET "phone" = "taqseem_pk_phone"("phone"),
  "whatsapp" = "taqseem_pk_phone"("whatsapp")
  WHERE "phone" IS NOT NULL OR "whatsapp" IS NOT NULL;
UPDATE "Staff" SET "phone" = "taqseem_pk_phone"("phone") WHERE "phone" IS NOT NULL;

DROP FUNCTION "taqseem_pk_phone"(TEXT);
