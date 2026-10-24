import { Prisma } from "@/generated/prisma/client";

// Pure purchasing rules (no database), unit-tested in calc.test.ts.

type Decimal = Prisma.Decimal;
type DecimalValue = Decimal | string | number;
const D = (v: DecimalValue) => new Prisma.Decimal(v);
const ZERO = D(0);
const DAY_MS = 24 * 60 * 60 * 1000;

export type OpenBill = {
  id: string;
  number: number;
  billDate: Date;
  dueDate: Date;
  /** netAmount minus posted allocations. */
  outstanding: DecimalValue;
};

export type Allocation = { billId: string; amount: Decimal };

/** Oldest due date first, then bill date, then bill number. */
export function sortOldestFirst<T extends Pick<OpenBill, "dueDate" | "billDate" | "number">>(
  bills: T[],
): T[] {
  return [...bills].sort(
    (a, b) =>
      a.dueDate.getTime() - b.dueDate.getTime() ||
      a.billDate.getTime() - b.billDate.getTime() ||
      a.number - b.number,
  );
}

/** Spreads a payment over open bills, oldest first. Any remainder stays unallocated (an advance). */
export function allocateOldestFirst(amount: DecimalValue, bills: OpenBill[]): Allocation[] {
  let left = D(amount);
  const result: Allocation[] = [];
  for (const bill of sortOldestFirst(bills)) {
    if (left.lte(0)) break;
    const outstanding = D(bill.outstanding);
    if (outstanding.lte(0)) continue;
    const take = Prisma.Decimal.min(left, outstanding);
    result.push({ billId: bill.id, amount: take });
    left = left.sub(take);
  }
  return result;
}

/** Checks a manual allocation; returns error messages (empty when valid). */
export function checkAllocations(
  amount: DecimalValue,
  allocations: Allocation[],
  bills: OpenBill[],
): string[] {
  const errors: string[] = [];
  const byId = new Map(bills.map((b) => [b.id, b]));
  const seen = new Set<string>();
  let total = ZERO;
  for (const a of allocations) {
    const bill = byId.get(a.billId);
    if (!bill) {
      errors.push("A payment can only be applied to this company's open bills.");
      continue;
    }
    if (seen.has(a.billId)) errors.push(`Bill #${bill.number} appears twice.`);
    seen.add(a.billId);
    if (a.amount.lte(0)) errors.push(`The amount for bill #${bill.number} must be more than zero.`);
    if (a.amount.gt(bill.outstanding)) {
      errors.push(`Bill #${bill.number} only has ${D(bill.outstanding).toFixed(2)} outstanding.`);
    }
    total = total.add(a.amount);
  }
  if (total.gt(amount))
    errors.push(
      `The allocations (${total.toFixed(2)}) are more than the payment (${D(amount).toFixed(2)}).`,
    );
  return errors;
}

export type BillState = {
  outstanding: Decimal;
  paid: Decimal;
  status: "PAID" | "PARTIAL" | "UNPAID" | "REVERSED";
  overdue: boolean;
  /** Positive when overdue, negative = due in N days, 0 = due today. */
  daysOverdue: number;
};

/** Paid / partial / unpaid and overdue for one company bill. `today` is a business date. */
export function billState(
  bill: { netAmount: DecimalValue; dueDate: Date; status: "POSTED" | "REVERSED" },
  paid: DecimalValue,
  today: Date,
): BillState {
  const net = D(bill.netAmount);
  const paidD = D(paid);
  const outstanding = Prisma.Decimal.max(net.sub(paidD), ZERO);
  const daysOverdue = Math.round((today.getTime() - bill.dueDate.getTime()) / DAY_MS);
  if (bill.status === "REVERSED")
    return { outstanding: ZERO, paid: paidD, status: "REVERSED", overdue: false, daysOverdue: 0 };
  const status = outstanding.isZero() ? "PAID" : paidD.gt(0) ? "PARTIAL" : "UNPAID";
  return {
    outstanding,
    paid: paidD,
    status,
    overdue: status !== "PAID" && daysOverdue > 0,
    daysOverdue,
  };
}

/** "due 5 days ago", "due today", "due in 3 days". */
export function dueText(daysOverdue: number): string {
  if (daysOverdue === 0) return "due today";
  if (daysOverdue > 0) return `due ${daysOverdue} ${daysOverdue === 1 ? "day" : "days"} ago`;
  const days = -daysOverdue;
  return `due in ${days} ${days === 1 ? "day" : "days"}`;
}

export type PendingClaim = { id: string; claimDate: Date; number: number; amount: DecimalValue };

/**
 * Which pending claims a new company bill deducts: oldest first, whole claims only, never more
 * than the bill. Claims that don't fit wait for the next bill.
 */
export function claimsToDeduct(
  gross: DecimalValue,
  claims: PendingClaim[],
): { ids: string[]; total: Decimal } {
  let room = D(gross);
  const ids: string[] = [];
  let total = ZERO;
  const sorted = [...claims].sort(
    (a, b) => a.claimDate.getTime() - b.claimDate.getTime() || a.number - b.number,
  );
  for (const claim of sorted) {
    const amount = D(claim.amount);
    if (amount.gt(room)) continue;
    ids.push(claim.id);
    total = total.add(amount);
    room = room.sub(amount);
  }
  return { ids, total };
}

/** Purchase order status from ordered vs received quantities per line. */
export function purchaseOrderStatus(
  current: "OPEN" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CLOSED" | "CANCELLED",
  lines: { ordered: number; received: number }[],
): "OPEN" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CLOSED" | "CANCELLED" {
  if (current === "CLOSED" || current === "CANCELLED") return current;
  const anyReceived = lines.some((l) => l.received > 0);
  if (!anyReceived) return "OPEN";
  return lines.every((l) => l.received >= l.ordered) ? "RECEIVED" : "PARTIALLY_RECEIVED";
}

/** Adds a business-day count to a @db.Date value. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export type LedgerRow = { debit: DecimalValue; credit: DecimalValue };

/**
 * Running "we owe" balance for a company ledger: credits (bills) increase it, debits (payments,
 * claims) reduce it.
 */
export function runningPayable<T extends LedgerRow>(
  opening: DecimalValue,
  rows: T[],
): (T & { balance: Decimal })[] {
  let balance = D(opening);
  return rows.map((row) => {
    balance = balance.add(D(row.credit)).sub(D(row.debit));
    return { ...row, balance };
  });
}
