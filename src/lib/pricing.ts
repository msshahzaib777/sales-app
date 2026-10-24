import Decimal from "decimal.js";

// Line pricing, shared by the server (stored amounts) and the order-entry screen (live totals), so
// both always agree. Uses decimal.js directly (the library behind Prisma's Decimal) so it can run
// in the browser without the Prisma client.

type DecimalInput = Decimal | number | string;

export type DiscountType = "NONE" | "PERCENT" | "AMOUNT_PER_UNIT";

export type LineInput = {
  /** Quantity in base units (packets for snacks). */
  quantity: number;
  /** How many base units one price unit holds (12 packets → dozen). */
  baseUnitsPerPriceUnit: number;
  /** Rate per price unit. */
  rate: DecimalInput;
  discountType?: DiscountType;
  /** Percent (0–100) or amount per price unit, depending on `discountType`. */
  discountValue?: DecimalInput;
  /** Percent; 0 while tax is off. */
  taxRate?: DecimalInput;
};

export type LineAmounts = {
  grossAmount: Decimal;
  discountAmount: Decimal;
  taxAmount: Decimal;
  netAmount: Decimal;
};

const D = (value: DecimalInput) => new Decimal(value);
const money = (value: Decimal) => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/**
 * Amounts for one order/bill line. Each component is rounded to paisa (2 dp, half up) before it is
 * combined, so stored line totals always add up exactly to the bill totals.
 */
export function calculateLineAmounts(input: LineInput): LineAmounts {
  const { quantity, baseUnitsPerPriceUnit } = input;
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error(`Quantity must be a non-negative integer of base units, got ${quantity}`);
  }
  if (!Number.isInteger(baseUnitsPerPriceUnit) || baseUnitsPerPriceUnit <= 0) {
    throw new Error(`Invalid unit conversion factor ${baseUnitsPerPriceUnit}`);
  }

  const priceUnits = D(quantity).div(baseUnitsPerPriceUnit);
  const grossAmount = money(priceUnits.mul(D(input.rate)));

  const discountValue = D(input.discountValue ?? 0);
  let discountAmount: Decimal;
  switch (input.discountType ?? "NONE") {
    case "NONE":
      discountAmount = D(0);
      break;
    case "PERCENT":
      if (discountValue.gt(100)) throw new Error("Percent discount cannot exceed 100");
      discountAmount = money(grossAmount.mul(discountValue).div(100));
      break;
    case "AMOUNT_PER_UNIT":
      discountAmount = money(priceUnits.mul(discountValue));
      break;
  }
  if (discountAmount.gt(grossAmount)) discountAmount = grossAmount;

  const taxAmount = money(
    grossAmount
      .sub(discountAmount)
      .mul(D(input.taxRate ?? 0))
      .div(100),
  );
  const netAmount = grossAmount.sub(discountAmount).add(taxAmount);

  return { grossAmount, discountAmount, taxAmount, netAmount };
}

/** Sums the amounts of several lines (e.g. a bill, or one company's slice of a bill). */
export function sumLineAmounts(lines: LineAmounts[]): LineAmounts {
  const zero = D(0);
  return lines.reduce<LineAmounts>(
    (total, line) => ({
      grossAmount: total.grossAmount.add(line.grossAmount),
      discountAmount: total.discountAmount.add(line.discountAmount),
      taxAmount: total.taxAmount.add(line.taxAmount),
      netAmount: total.netAmount.add(line.netAmount),
    }),
    { grossAmount: zero, discountAmount: zero, taxAmount: zero, netAmount: zero },
  );
}

export type Discount = { discountType: DiscountType; discountValue: DecimalInput };

/** A quantity slab: from `minQuantity` base units upward, this discount replaces the base one. */
export type DiscountTier = Discount & { minQuantity: number };

/**
 * Picks the discount for one product line: the highest slab the line quantity reaches, or the
 * product's base discount when it reaches none. Slabs are per product line and apply to the whole
 * line quantity (not only the part above the threshold).
 */
export function resolveDiscount(
  base: Discount,
  tiers: readonly DiscountTier[],
  quantity: number,
): Discount {
  let best: DiscountTier | undefined;
  for (const tier of tiers) {
    if (quantity >= tier.minQuantity && (!best || tier.minQuantity > best.minQuantity)) best = tier;
  }
  const chosen = best ?? base;
  // Return only the discount fields, even when callers pass a whole product as `base`.
  return { discountType: chosen.discountType, discountValue: chosen.discountValue };
}
