import Decimal from "decimal.js";

import { splitByWeight } from "./delivery";

// Customer payment allocation (SPEC §8), shared by the server and the payment screen. Pure.
//
// A payment goes to the customer's oldest debt first. The customer's old balance (paper bills from
// before the app, owed to us and not to a company, keyed OLD_BALANCE) comes first of all. Then debt
// the bills cannot explain (a company opening balance). Then posted bills, oldest first; a payment covering part of a bill with
// several companies is split across them in proportion to each company's unpaid amount on it.
// Anything left over is an advance.

type DecimalValue = Decimal | number | string;
const D = (v: DecimalValue) => new Decimal(v);
const ZERO = new Decimal(0);

/**
 * Key for the customer's old balance in the per-company maps below. It belongs to no company, so
 * its ledger rows have companyId null; never a real company id.
 */
export const OLD_BALANCE = "";

export type BillDebt = {
  billId: string;
  number: number;
  /** Unpaid amount of each company's slice of the bill (from allocations). */
  slices: { companyId: string; outstanding: DecimalValue }[];
};

export type Allocation = { billId: string; companyId: string; amount: Decimal };

export type PaymentSplit = {
  /** Rows to store as PaymentAllocation. */
  allocations: Allocation[];
  /** Ledger credit per company (allocations + opening balances + advance). */
  byCompany: Map<string, Decimal>;
  /** Not owed anywhere; credited to `advanceTo` companies. */
  advance: Decimal;
};

/**
 * What the customer really owes per company, bill by bill. `owed` is the ledger balance per
 * company: when it is less than the company's unpaid slices (an earlier advance), the excess pays
 * off the oldest slices first; when it is more, the difference is `unbilled` (opening balance).
 */
export function effectiveDebt(owed: Map<string, DecimalValue>, bills: BillDebt[]) {
  const unbilled = new Map<string, Decimal>();
  const credit = new Map<string, Decimal>();
  for (const [companyId, amount] of owed) {
    const slices = bills
      .flatMap((b) => b.slices)
      .filter((s) => s.companyId === companyId)
      .reduce((s, x) => s.add(x.outstanding), ZERO);
    const diff = D(amount).sub(slices);
    if (diff.gt(0)) unbilled.set(companyId, diff);
    else if (diff.lt(0)) credit.set(companyId, diff.neg());
  }
  const effective: BillDebt[] = bills.map((b) => ({
    ...b,
    slices: b.slices
      .map((s) => {
        let out = D(s.outstanding);
        const c = credit.get(s.companyId) ?? (owed.has(s.companyId) ? ZERO : out);
        const used = Decimal.min(c, out);
        credit.set(s.companyId, c.sub(used));
        out = out.sub(used);
        return { companyId: s.companyId, outstanding: out };
      })
      .filter((s) => s.outstanding.gt(0)),
  }));
  return { unbilled, bills: effective.filter((b) => b.slices.length > 0) };
}

const add = (m: Map<string, Decimal>, k: string, v: Decimal) => m.set(k, (m.get(k) ?? ZERO).add(v));

/** Oldest debt first, across companies (see the file comment). Bills must be oldest first. */
export function allocateOldestFirst(
  amount: DecimalValue,
  debt: { unbilled: Map<string, Decimal>; bills: BillDebt[] },
  advanceTo: [string, DecimalValue][],
): PaymentSplit {
  let left = D(amount);
  const byCompany = new Map<string, Decimal>();
  const allocations: Allocation[] = [];

  const old = debt.unbilled.get(OLD_BALANCE) ?? ZERO;
  if (old.gt(0) && left.gt(0)) {
    const take = Decimal.min(left, old);
    add(byCompany, OLD_BALANCE, take);
    left = left.sub(take);
  }

  const companies = [...debt.unbilled].filter(([k]) => k !== OLD_BALANCE);
  const unbilledTotal = companies.reduce((s, [, v]) => s.add(v), ZERO);
  if (unbilledTotal.gt(0) && left.gt(0)) {
    const take = Decimal.min(left, unbilledTotal);
    const parts = take.eq(unbilledTotal)
      ? new Map(companies.map(([k, v]) => [k, D(v)]))
      : splitByWeight(take, companies);
    for (const [companyId, part] of parts) add(byCompany, companyId, part);
    left = left.sub(take);
  }

  for (const bill of debt.bills) {
    if (left.lte(0)) break;
    const total = bill.slices.reduce((s, x) => s.add(x.outstanding), ZERO);
    if (total.lte(0)) continue;
    const take = Decimal.min(left, total);
    const parts = take.eq(total)
      ? new Map(bill.slices.map((s) => [s.companyId, D(s.outstanding)]))
      : splitByWeight(
          take,
          bill.slices.map((s) => [s.companyId, s.outstanding]),
        );
    for (const [companyId, part] of parts) {
      if (part.lte(0)) continue;
      allocations.push({ billId: bill.billId, companyId, amount: part });
      add(byCompany, companyId, part);
    }
    left = left.sub(take);
  }

  const advance = left.gt(0) ? left : ZERO;
  if (advance.gt(0) && advanceTo.length > 0) {
    for (const [companyId, part] of splitByWeight(advance, advanceTo))
      add(byCompany, companyId, part);
  }
  return { allocations, byCompany, advance };
}

/**
 * Manual split: the user says how much goes to each company (and to the old balance); within a
 * company it pays the opening balance, then that company's bill slices oldest first. Any rest is an
 * advance with that company.
 */
export function allocateByCompany(
  perCompany: Map<string, DecimalValue>,
  debt: { unbilled: Map<string, Decimal>; bills: BillDebt[] },
): PaymentSplit {
  const allocations: Allocation[] = [];
  const byCompany = new Map<string, Decimal>();
  let advance = ZERO;
  for (const [companyId, value] of perCompany) {
    const amount = D(value);
    if (amount.lte(0)) continue;
    byCompany.set(companyId, amount);
    let left = amount.sub(Decimal.min(amount, debt.unbilled.get(companyId) ?? ZERO));
    for (const bill of debt.bills) {
      if (left.lte(0)) break;
      const slice = bill.slices.find((s) => s.companyId === companyId);
      if (!slice) continue;
      const take = Decimal.min(left, D(slice.outstanding));
      if (take.lte(0)) continue;
      allocations.push({ billId: bill.billId, companyId, amount: take });
      left = left.sub(take);
    }
    advance = advance.add(left);
  }
  return { allocations, byCompany, advance };
}

/** Checks a manual split; returns messages (empty when valid). */
export function checkCompanySplit(
  amount: DecimalValue,
  perCompany: Map<string, DecimalValue>,
): string[] {
  const total = [...perCompany.values()].reduce<Decimal>((s, v) => s.add(v), ZERO);
  if ([...perCompany.values()].some((v) => D(v).lt(0)))
    return ["Company amounts cannot be negative."];
  if (!total.eq(D(amount)))
    return [
      `The company amounts add up to ${total.toFixed(2)}, not the payment of ${D(amount).toFixed(2)}.`,
    ];
  return [];
}

export const CHEQUE_STATUS_LABEL = {
  PENDING: "Pending",
  CLEARED: "Cleared",
  BOUNCED: "Bounced",
} as const;
