import { Prisma } from "@/generated/prisma/client";

type Decimal = Prisma.Decimal;
type DecimalInput = Decimal | number | string;

export type DiscountType = "NONE" | "PERCENT" | "AMOUNT_PER_UNIT";

export type LineInput = {
  /** Quantity in base units (half dozens for snacks). */
  quantity: number;
  /** How many base units one price unit holds (2 for half dozen → dozen). */
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

const D = (value: DecimalInput) => new Prisma.Decimal(value);
const money = (value: Decimal) => value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

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
