import "server-only";

import { Prisma } from "@/generated/prisma/client";

import type { TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";
import { nextDocumentNumber } from "../posting";
import type { ServiceCtx } from "./common";

// Opening balances are OPENING_BALANCE ledger entries, never a column (journal is the truth).
// Setting a new opening balance posts only the difference, so the history stays append-only.
//
// Amounts here are "as the user thinks of them":
// - customer × company: what the customer owes us (negative = advance paid);
// - company: what we owe the company (negative = they owe us).

type Party =
  | { kind: "CUSTOMER"; customerId: string; companyId: string }
  | { kind: "COMPANY"; companyId: string };

type DecimalValue = Prisma.Decimal | number | string;

const D = (v: DecimalValue) => new Prisma.Decimal(v);

function partyWhere(party: Party) {
  return party.kind === "CUSTOMER"
    ? { partyType: "CUSTOMER" as const, customerId: party.customerId, companyId: party.companyId }
    : { partyType: "COMPANY" as const, companyId: party.companyId };
}

/** Ledger sign (debit − credit) ↔ user-facing amount. */
const toUserAmount = (party: Party, signed: Prisma.Decimal) =>
  party.kind === "CUSTOMER" ? signed : signed.neg();

export async function getOpeningBalance(
  tx: Pick<TenantTx, "ledgerEntry">,
  party: Party,
): Promise<Prisma.Decimal> {
  const sum = await tx.ledgerEntry.aggregate({
    where: { ...partyWhere(party), type: "OPENING_BALANCE" },
    _sum: { debit: true, credit: true },
  });
  return toUserAmount(party, D(sum._sum.debit ?? 0).sub(sum._sum.credit ?? 0));
}

/** Opening balance per company for one customer (companies without an entry are omitted). */
export async function getCustomerOpeningBalances(
  tx: Pick<TenantTx, "ledgerEntry">,
  customerId: string,
) {
  const groups = await tx.ledgerEntry.groupBy({
    by: ["companyId"],
    where: { partyType: "CUSTOMER", customerId, type: "OPENING_BALANCE" },
    _sum: { debit: true, credit: true },
  });
  const result: Record<string, Prisma.Decimal> = {};
  for (const g of groups) {
    if (g.companyId) result[g.companyId] = D(g._sum.debit ?? 0).sub(g._sum.credit ?? 0);
  }
  return result;
}

/**
 * Makes the party's opening balance equal `target` by posting the difference. Returns the change
 * (old → new) or null when nothing changed. Call inside the caller's transaction.
 */
export async function setOpeningBalance(
  tx: TenantTx,
  ctx: ServiceCtx,
  party: Party,
  target: DecimalValue,
  entryDate: Date,
): Promise<{ from: string; to: string } | null> {
  const current = await getOpeningBalance(tx, party);
  const wanted = D(target);
  const deltaUser = wanted.sub(current);
  if (deltaUser.isZero()) return null;
  const deltaSigned = party.kind === "CUSTOMER" ? deltaUser : deltaUser.neg();

  await tx.ledgerEntry.create({
    data: {
      tenantId: ctx.user.tenantId,
      ...partyWhere(party),
      type: "OPENING_BALANCE",
      entryDate,
      debit: deltaSigned.gt(0) ? deltaSigned : 0,
      credit: deltaSigned.lt(0) ? deltaSigned.neg() : 0,
      description: current.isZero()
        ? "Opening balance"
        : `Opening balance changed from ${current.toFixed(2)} to ${wanted.toFixed(2)}`,
      createdById: ctx.user.id,
    },
  });
  return { from: current.toFixed(2), to: wanted.toFixed(2) };
}

/** Current balance (all entries) per customer: positive = owes us. */
export async function customerBalances(tx: Pick<TenantTx, "ledgerEntry">, customerIds: string[]) {
  if (customerIds.length === 0) return new Map<string, Prisma.Decimal>();
  const groups = await tx.ledgerEntry.groupBy({
    by: ["customerId"],
    where: { partyType: "CUSTOMER", customerId: { in: customerIds } },
    _sum: { debit: true, credit: true },
  });
  return new Map(groups.map((g) => [g.customerId!, D(g._sum.debit ?? 0).sub(g._sum.credit ?? 0)]));
}

/** Current payable per company: positive = we owe them. */
export async function companyPayables(tx: Pick<TenantTx, "ledgerEntry">, companyIds: string[]) {
  if (companyIds.length === 0) return new Map<string, Prisma.Decimal>();
  const groups = await tx.ledgerEntry.groupBy({
    by: ["companyId"],
    where: { partyType: "COMPANY", companyId: { in: companyIds } },
    _sum: { debit: true, credit: true },
  });
  return new Map(groups.map((g) => [g.companyId!, D(g._sum.credit ?? 0).sub(g._sum.debit ?? 0)]));
}

/**
 * Keeps the company's opening-balance bill equal to its opening balance, so payments can be applied
 * to it like any other bill (oldest first: it is the oldest debt). Refuses to go below what has
 * already been paid against it.
 */
export async function syncCompanyOpeningBill(
  tx: TenantTx,
  ctx: ServiceCtx,
  companyId: string,
  target: DecimalValue,
  date: Date,
) {
  const amount = D(target);
  const bill = await tx.companyBill.findFirst({ where: { companyId, kind: "OPENING_BALANCE" } });
  if (bill) {
    const paid = await tx.companyPaymentAllocation.aggregate({
      where: { companyBillId: bill.id, companyPayment: { status: "POSTED" } },
      _sum: { amount: true },
    });
    const paidAmount = D(paid._sum.amount ?? 0);
    if (amount.lt(paidAmount)) {
      throw new ServiceError(
        `Payments of ${paidAmount.toFixed(2)} were already applied to the opening balance, so it cannot be less than that.`,
      );
    }
    if (amount.gt(0) || paidAmount.gt(0)) {
      await tx.companyBill.update({
        where: { id: bill.id },
        data: { grossAmount: amount, netAmount: amount, status: "POSTED" },
      });
    } else {
      // Nothing owed any more; keep the row (reversed payments may point at it) but close it.
      await tx.companyBill.update({
        where: { id: bill.id },
        data: { grossAmount: 0, netAmount: 0, status: "REVERSED" },
      });
    }
    return;
  }
  if (amount.lte(0)) return;
  await tx.companyBill.create({
    data: {
      tenantId: ctx.user.tenantId,
      number: await nextDocumentNumber(tx, ctx, "COMPANY_BILL"),
      companyId,
      kind: "OPENING_BALANCE",
      billDate: date,
      dueDate: date,
      grossAmount: amount,
      netAmount: amount,
      createdById: ctx.user.id,
    },
  });
}
