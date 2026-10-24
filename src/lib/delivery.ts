import Decimal from "decimal.js";

import { calculateLineAmounts, type DiscountType } from "./pricing";
import type { OrderStatus, PricedLine } from "./sales";
import { HALF_DOZENS_PER_DOZEN } from "./units";

// Dispatch and day-end rules (SPEC §7), shared by the server and the day-end screen. Pure.

type DecimalValue = Decimal | number | string;
const D = (v: DecimalValue) => new Decimal(v);

/** A bill line as booked (rate and discount are the booking snapshot). */
export type BookedLine = {
  productId: string;
  companyId: string;
  /** Half dozens ordered. */
  quantity: number;
  rate: DecimalValue;
  discountType: DiscountType;
  discountValue: DecimalValue;
  taxAmount?: DecimalValue;
};

export type LineResult = { productId: string; returned: number; damaged: number };

/** Checks one order's day-end quantities; returns messages (empty when valid). */
export function checkLineResults(
  lines: Pick<BookedLine, "productId" | "quantity">[],
  results: LineResult[],
  names: Map<string, string> = new Map(),
): string[] {
  const errors: string[] = [];
  const byProduct = new Map(lines.map((l) => [l.productId, l]));
  for (const r of results) {
    const line = byProduct.get(r.productId);
    const name = names.get(r.productId) ?? "A product";
    if (!line) {
      errors.push(`${name} is not on this order.`);
      continue;
    }
    if (r.returned < 0 || r.damaged < 0 || !Number.isInteger(r.returned + r.damaged)) {
      errors.push(`${name}: enter returned and damaged as dozens (halves allowed).`);
    } else if (r.returned + r.damaged > line.quantity) {
      errors.push(`${name}: returned and damaged are more than the quantity sent.`);
    }
  }
  return errors;
}

/**
 * The bill after delivery: each line re-priced on what the customer kept (ordered − returned −
 * damaged) at the booked rate and per-dozen discount. Lines with nothing delivered drop off.
 */
export function deliveredLines(lines: BookedLine[], results: LineResult[]): PricedLine[] {
  const byProduct = new Map(results.map((r) => [r.productId, r]));
  return lines
    .map((l) => {
      const r = byProduct.get(l.productId);
      const quantity = l.quantity - (r?.returned ?? 0) - (r?.damaged ?? 0);
      const amounts = calculateLineAmounts({
        quantity,
        baseUnitsPerPriceUnit: HALF_DOZENS_PER_DOZEN,
        rate: l.rate,
        discountType: l.discountType,
        discountValue: l.discountValue,
      });
      return {
        productId: l.productId,
        companyId: l.companyId,
        quantity,
        rate: D(l.rate),
        discountType: l.discountType,
        discountValue: D(l.discountValue),
        ...amounts,
      };
    })
    .filter((l) => l.quantity > 0);
}

/** Delivered, partly delivered or returned (refused), from the day-end quantities. */
export function deliveryStatus(
  lines: Pick<BookedLine, "productId" | "quantity">[],
  results: LineResult[],
): Extract<OrderStatus, "DELIVERED" | "PARTIALLY_DELIVERED" | "RETURNED"> {
  const ordered = lines.reduce((s, l) => s + l.quantity, 0);
  const notDelivered = results.reduce((s, r) => s + r.returned + r.damaged, 0);
  if (notDelivered === 0) return "DELIVERED";
  return notDelivered >= ordered ? "RETURNED" : "PARTIALLY_DELIVERED";
}

/**
 * Splits an amount over keys in proportion to their weights, to the paisa; the last key takes the
 * rounding difference so the parts always add up exactly. Keys with no positive weight get nothing;
 * when no weight is positive, the first key gets everything.
 */
export function splitByWeight<K>(
  amount: DecimalValue,
  weights: [K, DecimalValue][],
): Map<K, Decimal> {
  const total = D(amount);
  const positive = weights.filter(([, w]) => D(w).gt(0));
  const result = new Map<K, Decimal>();
  if (positive.length === 0) {
    if (weights.length > 0) result.set(weights[0]![0], total);
    return result;
  }
  const sum = positive.reduce((s, [, w]) => s.add(w), new Decimal(0));
  let given = new Decimal(0);
  positive.forEach(([key, w], i) => {
    const part =
      i === positive.length - 1
        ? total.sub(given)
        : total.mul(w).div(sum).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    given = given.add(part);
    if (!part.isZero()) result.set(key, part);
  });
  return result;
}

/** Takes `quantity` from batches oldest first; whatever the batches cannot cover is `unbatched`. */
export function takeFromBatches(
  quantity: number,
  batches: { id: string; available: number }[],
): { slices: { batchId: string; quantity: number }[]; unbatched: number } {
  let left = quantity;
  const slices: { batchId: string; quantity: number }[] = [];
  for (const b of batches) {
    if (left <= 0) break;
    if (b.available <= 0) continue;
    const take = Math.min(left, b.available);
    slices.push({ batchId: b.id, quantity: take });
    left -= take;
  }
  return { slices, unbatched: left };
}

/** Total half dozens per product over several orders (a trip's loading sheet). */
export function loadByProduct(
  lines: { productId: string; quantity: number }[],
): Map<string, number> {
  const load = new Map<string, number>();
  for (const l of lines) load.set(l.productId, (load.get(l.productId) ?? 0) + l.quantity);
  return load;
}

export const TRIP_STATUS_LABEL = {
  PLANNED: "Planned",
  DISPATCHED: "Dispatched",
  RECONCILED: "Day-end done",
  CANCELLED: "Cancelled",
} as const;
