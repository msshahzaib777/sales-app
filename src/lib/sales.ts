import Decimal from "decimal.js";

import {
  calculateLineAmounts,
  type DiscountTier,
  type DiscountType,
  resolveDiscount,
} from "./pricing";
import { HALF_DOZENS_PER_DOZEN } from "./units";

// Sales order rules shared by the server (what is stored) and the order-entry screen (what the user
// sees while typing), so both always agree. Pure: no database, no Prisma.

type DecimalValue = Decimal | number | string;
const D = (v: DecimalValue) => new Decimal(v);
const ZERO = new Decimal(0);

export type PricedProduct = {
  id: string;
  companyId: string;
  saleRate: DecimalValue;
  discountType: DiscountType;
  discountValue: DecimalValue;
  tiers: DiscountTier[];
};

export type PricedLine = {
  productId: string;
  companyId: string;
  /** Half dozens. */
  quantity: number;
  rate: Decimal;
  discountType: DiscountType;
  discountValue: Decimal;
  grossAmount: Decimal;
  discountAmount: Decimal;
  taxAmount: Decimal;
  netAmount: Decimal;
};

/** Prices one order line: sale rate, and the company discount (or the slab the quantity reaches). */
export function priceLine(product: PricedProduct, quantity: number): PricedLine {
  const discount = resolveDiscount(
    { discountType: product.discountType, discountValue: product.discountValue },
    product.tiers,
    quantity,
  );
  const amounts = calculateLineAmounts({
    quantity,
    baseUnitsPerPriceUnit: HALF_DOZENS_PER_DOZEN,
    rate: product.saleRate,
    discountType: discount.discountType,
    discountValue: discount.discountValue,
  });
  return {
    productId: product.id,
    companyId: product.companyId,
    quantity,
    rate: D(product.saleRate),
    discountType: discount.discountType,
    discountValue: D(discount.discountValue),
    ...amounts,
  };
}

export type Totals = {
  grossAmount: Decimal;
  discountAmount: Decimal;
  taxAmount: Decimal;
  netAmount: Decimal;
  quantity: number;
};

const emptyTotals = (): Totals => ({
  grossAmount: ZERO,
  discountAmount: ZERO,
  taxAmount: ZERO,
  netAmount: ZERO,
  quantity: 0,
});

function add(
  t: Totals,
  l: Pick<PricedLine, "grossAmount" | "discountAmount" | "taxAmount" | "netAmount" | "quantity">,
): Totals {
  return {
    grossAmount: t.grossAmount.add(l.grossAmount),
    discountAmount: t.discountAmount.add(l.discountAmount),
    taxAmount: t.taxAmount.add(l.taxAmount),
    netAmount: t.netAmount.add(l.netAmount),
    quantity: t.quantity + l.quantity,
  };
}

/** Bill totals, overall and per company (each company's slice posts to its customer ledger). */
export function billTotals(
  lines: Pick<
    PricedLine,
    "companyId" | "grossAmount" | "discountAmount" | "taxAmount" | "netAmount" | "quantity"
  >[],
) {
  let total = emptyTotals();
  const byCompany = new Map<string, Totals>();
  for (const line of lines) {
    total = add(total, line);
    byCompany.set(line.companyId, add(byCompany.get(line.companyId) ?? emptyTotals(), line));
  }
  return { total, byCompany };
}

export type CreditCheck = {
  limit: Decimal | null;
  /** Ledger balance now (posted bills minus payments). */
  pending: Decimal;
  /** Booked / planned orders not yet posted, other than this one. */
  openOrders: Decimal;
  thisOrder: Decimal;
  /** pending + open orders + this order. */
  exposure: Decimal;
  /** How far past the limit (null when within it, or no limit). */
  over: Decimal | null;
};

/** Would this order take the customer past their credit limit? */
export function checkCredit(input: {
  creditLimit: DecimalValue | null;
  pending: DecimalValue;
  openOrders: DecimalValue;
  thisOrder: DecimalValue;
}): CreditCheck {
  const pending = D(input.pending);
  const openOrders = D(input.openOrders);
  const thisOrder = D(input.thisOrder);
  const exposure = pending.add(openOrders).add(thisOrder);
  const limit = input.creditLimit === null ? null : D(input.creditLimit);
  const over = limit !== null && exposure.gt(limit) && thisOrder.gt(0) ? exposure.sub(limit) : null;
  return { limit, pending, openOrders, thisOrder, exposure, over };
}

/**
 * The least the customer should pay against a bill: everything left over from earlier bills, or
 * whatever takes the total due back within the credit limit, whichever is more. With no limit it is
 * just the earlier balance. Never below zero (an advance in hand means nothing is owed yet).
 */
export function minimumPayment(input: {
  previous: DecimalValue;
  totalDue: DecimalValue;
  creditLimit: DecimalValue | null;
}): Decimal {
  const previous = D(input.previous);
  const overLimit =
    input.creditLimit === null ? new Decimal(0) : D(input.totalDue).sub(input.creditLimit);
  return Decimal.max(previous, overLimit, 0);
}

// ───────────── Status machine (SPEC §6) ─────────────

export const ORDER_STATUSES = [
  "BOOKED",
  "PLANNED",
  "DISPATCHED",
  "DELIVERED",
  "PARTIALLY_DELIVERED",
  "RETURNED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Booked → Planned → Dispatched → Delivered / Partially delivered / Returned. Booked and planned
 * orders can be cancelled (or moved back to booked). After dispatch, only day-end reconciliation
 * changes an order.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  BOOKED: ["PLANNED", "DISPATCHED", "CANCELLED"],
  PLANNED: ["BOOKED", "DISPATCHED", "CANCELLED"],
  DISPATCHED: ["DELIVERED", "PARTIALLY_DELIVERED", "RETURNED"],
  DELIVERED: [],
  PARTIALLY_DELIVERED: [],
  RETURNED: [],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Orders can be edited (and still reserve stock) until they are dispatched. */
export function isOpenOrder(status: OrderStatus): boolean {
  return status === "BOOKED" || status === "PLANNED";
}

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  BOOKED: "Booked",
  PLANNED: "Planned",
  DISPATCHED: "Dispatched",
  DELIVERED: "Delivered",
  PARTIALLY_DELIVERED: "Partly delivered",
  RETURNED: "Returned",
  CANCELLED: "Cancelled",
};
