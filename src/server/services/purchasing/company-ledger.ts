import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { LedgerEntryType } from "@/generated/prisma/enums";
import { businessToday } from "@/lib/dates";

import { assertCan } from "../../auth/permissions";
import type { ServiceCtx } from "../master/common";
import { found } from "../posting";
import { paidByBill } from "./bills";
import { billState, runningPayable } from "./calc";
import type { DateRange } from "./filters";

// Company ledger: every bill, payment, claim, opening balance and reversal with a running
// balance of what we owe the company, plus each bill's status.

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

export const LEDGER_TYPE_LABEL: Record<LedgerEntryType, string> = {
  OPENING_BALANCE: "Opening balance",
  SALES_BILL: "Bill",
  BILL_REVISION: "Bill revision",
  CUSTOMER_PAYMENT: "Payment",
  CHEQUE_BOUNCE: "Cheque bounced",
  COMPANY_BILL: "Bill",
  COMPANY_PAYMENT: "Payment",
  COMPANY_CLAIM: "Claim",
  ADJUSTMENT: "Adjustment",
  REVERSAL: "Reversal",
};

/** Where a ledger row's source document can be opened. */
export function referenceHref(
  referenceType: string | null,
  referenceId: string | null,
): string | null {
  if (!referenceType || !referenceId) return null;
  switch (referenceType) {
    case "CompanyBill":
      return `/purchases/bills/${referenceId}`;
    case "CompanyPayment":
      return `/purchases/payments/${referenceId}`;
    case "CompanyClaim":
      return `/purchases/claims?highlight=${referenceId}`;
    default:
      return null;
  }
}

export async function getCompanyLedger(ctx: ServiceCtx, companyId: string, range: DateRange) {
  assertCan(ctx.user.role, "ledgers.view");
  const company = found(
    await ctx.db.company.findUnique({
      where: { id: companyId },
      include: { warehouse: { select: { name: true } } },
    }),
    "company",
  );
  const where = { partyType: "COMPANY" as const, companyId };

  const before = range.from
    ? await ctx.db.ledgerEntry.aggregate({
        where: { ...where, entryDate: { lt: range.from } },
        _sum: { debit: true, credit: true },
      })
    : null;
  const opening = before ? D(before._sum.credit ?? 0).sub(before._sum.debit ?? 0) : D(0);

  const entries = await ctx.db.ledgerEntry.findMany({
    where: {
      ...where,
      ...(range.from || range.to
        ? {
            entryDate: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lte: range.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
  });
  const rows = runningPayable(opening, entries).map((e) => ({
    id: e.id,
    entryDate: e.entryDate,
    type: e.type,
    typeLabel: LEDGER_TYPE_LABEL[e.type],
    description: e.description ?? "",
    debit: e.debit,
    credit: e.credit,
    balance: e.balance,
    href: referenceHref(e.referenceType, e.referenceId),
  }));
  const closing = rows.at(-1)?.balance ?? opening;

  // Bill-wise status (all bills, not limited by the date range: what is still open matters).
  const bills = await ctx.db.companyBill.findMany({
    where: { companyId },
    orderBy: [{ billDate: "desc" }, { number: "desc" }],
    take: 200,
  });
  const paid = await paidByBill(
    ctx.db,
    bills.map((b) => b.id),
  );
  const today = businessToday();
  const billRows = bills.map((b) => ({ ...b, ...billState(b, paid.get(b.id) ?? 0, today) }));

  const [all, pendingClaims] = await Promise.all([
    ctx.db.ledgerEntry.aggregate({ where, _sum: { debit: true, credit: true } }),
    ctx.db.companyClaim.aggregate({
      where: { companyId, status: "PENDING" },
      _sum: { amount: true },
    }),
  ]);
  const payableNow = D(all._sum.credit ?? 0).sub(all._sum.debit ?? 0);
  const open = billRows.filter((b) => b.outstanding.gt(0));

  return {
    company,
    range,
    opening,
    closing,
    rows,
    bills: billRows,
    summary: {
      payableNow,
      openBills: open.reduce((s, b) => s.add(b.outstanding), D(0)),
      overdue: open.filter((b) => b.overdue).reduce((s, b) => s.add(b.outstanding), D(0)),
      overdueCount: open.filter((b) => b.overdue).length,
      pendingClaims: D(pendingClaims._sum.amount ?? 0),
    },
  };
}
