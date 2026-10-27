import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { recordIdSchema } from "@/lib/validation/master";

import { writeAudit } from "../../audit";
import { assertCan } from "../../auth/permissions";
import type { TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";
import type { ServiceCtx } from "../master/common";
import { found } from "../posting";
import { openBillsFor } from "./bills";
import { matchAdvances } from "./calc";

// Advances to companies: money paid with no bill to match (or more than the bills), e.g. paid
// ahead of a delivery. The ledger already counts it (the company owes us until goods come); what
// was missing is matching it to the bills that follow, so they show as paid. Matching only adds
// CompanyPaymentAllocation rows; no money moves and the ledger is untouched.

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

/** The company's posted payments with money not matched to any bill yet, oldest first. */
export async function companyAdvances(tx: TenantTx | ServiceCtx["db"], companyId: string) {
  const payments = await tx.companyPayment.findMany({
    where: { companyId, status: "POSTED" },
    orderBy: [{ paymentDate: "asc" }, { number: "asc" }],
    select: {
      id: true,
      number: true,
      paymentDate: true,
      amount: true,
      allocations: { select: { amount: true } },
    },
  });
  return payments
    .map((p) => ({
      paymentId: p.id,
      number: p.number,
      paymentDate: p.paymentDate,
      left: p.amount.sub(p.allocations.reduce((s, a) => s.add(a.amount), D(0))),
    }))
    .filter((a) => a.left.gt(0));
}

/**
 * Pays open bills from the company's advances (all open bills, or only `billId`), oldest first.
 * Inside the caller's transaction; audited on each bill. Returns what was matched.
 */
export async function applyAdvances(
  tx: TenantTx,
  ctx: ServiceCtx,
  companyId: string,
  billId?: string,
) {
  const advances = await companyAdvances(tx, companyId);
  if (advances.length === 0) return [];
  const open = (await openBillsFor(tx, companyId)).filter((b) => !billId || b.id === billId);
  const matches = matchAdvances(advances, open);
  for (const m of matches) {
    // One row per payment and bill: add to it when this payment already paid part of the bill.
    const existing = await tx.companyPaymentAllocation.findFirst({
      where: { companyPaymentId: m.paymentId, companyBillId: m.billId },
    });
    if (existing) {
      await tx.companyPaymentAllocation.update({
        where: { id: existing.id },
        data: { amount: existing.amount.add(m.amount) },
      });
    } else {
      await tx.companyPaymentAllocation.create({
        data: {
          tenantId: ctx.user.tenantId,
          companyPaymentId: m.paymentId,
          companyBillId: m.billId,
          companyId,
          amount: m.amount,
        },
      });
    }
  }
  const byBill = new Map<string, { payment: number; amount: string }[]>();
  for (const m of matches) {
    const number = advances.find((a) => a.paymentId === m.paymentId)!.number;
    byBill.set(m.billId, [
      ...(byBill.get(m.billId) ?? []),
      { payment: number, amount: m.amount.toFixed(2) },
    ]);
  }
  for (const [id, paidFrom] of byBill) {
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "CompanyBill",
      entityId: id,
      newValue: { paidFromAdvance: paidFrom },
    });
  }
  return matches;
}

/** "Use advance" on a company bill: pays it from the company's advances as far as they go. */
export async function payBillFromAdvance(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "payments.manage");
  const { id } = recordIdSchema.parse(input);
  // Serializable: a payment entered at the same moment must not use the same advance.
  return ctx.db.$transaction(
    async (tx) => {
      const bill = found(await tx.companyBill.findUnique({ where: { id } }), "company bill");
      if (bill.status !== "POSTED") throw new ServiceError("This bill is cancelled.");
      const matches = await applyAdvances(tx, ctx, bill.companyId, bill.id);
      if (matches.length === 0)
        throw new ServiceError("There is no advance to use, or this bill is already paid.");
      return matches.reduce((s, m) => s.add(m.amount), D(0));
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/**
 * Unmatches a bill's payments (its goods receipt is being cancelled): the payments stay posted and
 * their money is an advance again, for the company's next bill. Inside the caller's transaction.
 */
export async function releaseBillPayments(tx: TenantTx, ctx: ServiceCtx, billId: string) {
  const allocations = await tx.companyPaymentAllocation.findMany({
    where: { companyBillId: billId },
    include: { companyPayment: { select: { number: true } } },
  });
  if (allocations.length === 0) return;
  await tx.companyPaymentAllocation.deleteMany({ where: { companyBillId: billId } });
  await writeAudit(tx, ctx.user, {
    action: "UPDATE",
    entityType: "CompanyBill",
    entityId: billId,
    oldValue: {
      paidBy: allocations.map((a) => ({ payment: a.companyPayment.number, amount: a.amount })),
    },
    newValue: { paidBy: [], note: "receipt cancelled; the payments are advances again" },
  });
}
