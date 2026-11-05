// The rates sheet's cells (Products → Edit rates): how a product's discount and quantity slabs
// are written as one line of text, and read back. Shared by the sheet (display) and the server
// (saving), so both read a cell the same way.
//
//   Discount        "5%"  → 5 percent      "5" or "Rs 5" → Rs 5 per dozen      ""  → none
//   Quantity slabs  "25=3, 50=5"  → from 25 dozen 3, from 50 dozen 5, in the discount's unit
//                   (percent or Rs per dozen); "" → none. "2dz 6pk=1" also works for quantities.

import { quantityText } from "./units";

export type DiscountKind = "NONE" | "AMOUNT_PER_UNIT" | "PERCENT";

/** "110.00" → "110", "5.50" → "5.5": shorter to read and type in a cell. */
export function shortMoney(value: string | { toString(): string }): string {
  const n = Number(value.toString());
  return Number.isFinite(n) ? String(Number(n.toFixed(2))) : value.toString();
}

export function discountText(type: string, value: string | { toString(): string }): string {
  if (type === "NONE" || Number(value.toString()) === 0) return "";
  return type === "PERCENT" ? `${shortMoney(value)}%` : shortMoney(value);
}

export type ParsedDiscount =
  { ok: true; discountType: DiscountKind; discountValue: string } | { ok: false; error: string };

export function parseDiscount(text: string): ParsedDiscount {
  const t = text.trim().replace(/,/g, "");
  if (t === "" || /^0+(\.0+)?%?$/.test(t))
    return { ok: true, discountType: "NONE", discountValue: "0" };
  const percent = /^(\d+(?:\.\d{1,2})?)\s*%$/.exec(t);
  if (percent) return { ok: true, discountType: "PERCENT", discountValue: percent[1]! };
  const amount = /^(?:rs\.?\s*)?(\d+(?:\.\d{1,2})?)$/i.exec(t);
  if (amount) return { ok: true, discountType: "AMOUNT_PER_UNIT", discountValue: amount[1]! };
  return { ok: false, error: "Write 5% for percent, 5 for Rs 5 per dozen, or leave blank" };
}

export function slabsText(
  slabs: { minQuantity: number; discountValue: string | { toString(): string } }[],
): string {
  return slabs
    .map((s) => `${quantityText(s.minQuantity)}=${shortMoney(s.discountValue)}`)
    .join(", ");
}

export type ParsedSlabs =
  { ok: true; slabs: { fromDozens: string; value: string }[] } | { ok: false; error: string };

export function parseSlabs(text: string): ParsedSlabs {
  const parts = text
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
  const slabs: { fromDozens: string; value: string }[] = [];
  for (const part of parts) {
    const m = /^(.+?)\s*[=:]\s*(?:rs\.?\s*)?(\d+(?:\.\d{1,2})?)\s*%?$/i.exec(part);
    if (!m) return { ok: false, error: "Write each slab as dozens=discount, e.g. 25=3, 50=5" };
    slabs.push({ fromDozens: m[1]!.trim(), value: m[2]! });
  }
  return { ok: true, slabs };
}
