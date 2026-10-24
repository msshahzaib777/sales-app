import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { LedgerEntryType } from "@/generated/prisma/enums";

import type { TenantTx } from "../db/tenant";
import { ServiceError } from "./errors";
import type { ServiceCtx } from "./master/common";

// Helpers for posting to the two journals (CLAUDE.md rule 2) and numbering documents. Always call
// them inside the caller's transaction, so a document and its postings are saved together.

export type DocumentKey =
  | "PURCHASE_ORDER"
  | "GOODS_RECEIPT"
  | "COMPANY_BILL"
  | "COMPANY_PAYMENT"
  | "COMPANY_CLAIM"
  | "SALES_ORDER"
  | "BILL"
  | "CUSTOMER_PAYMENT"
  | "DELIVERY_TRIP";

/**
 * Next number for a document type, e.g. PO #13. The row update locks the counter until the
 * transaction ends, so concurrent posts get different numbers.
 */
export async function nextDocumentNumber(
  tx: TenantTx,
  ctx: ServiceCtx,
  key: DocumentKey,
): Promise<number> {
  const row = await tx.documentSequence.upsert({
    where: { tenantId_key: { tenantId: ctx.user.tenantId, key } },
    create: { tenantId: ctx.user.tenantId, key, nextValue: 2 },
    update: { nextValue: { increment: 1 } },
  });
  return row.nextValue - 1;
}

type DecimalValue = Prisma.Decimal | string | number;

/** One company ledger entry. Positive `credit` = we owe more; `debit` = we owe less. */
export async function postCompanyLedger(
  tx: TenantTx,
  ctx: ServiceCtx,
  entry: {
    companyId: string;
    type: LedgerEntryType;
    entryDate: Date;
    debit?: DecimalValue;
    credit?: DecimalValue;
    description: string;
    referenceType: string;
    referenceId: string;
    requestId?: string;
  },
) {
  return tx.ledgerEntry.create({
    data: {
      tenantId: ctx.user.tenantId,
      partyType: "COMPANY",
      companyId: entry.companyId,
      type: entry.type,
      entryDate: entry.entryDate,
      debit: entry.debit ?? 0,
      credit: entry.credit ?? 0,
      description: entry.description,
      referenceType: entry.referenceType,
      referenceId: entry.referenceId,
      requestId: entry.requestId,
      createdById: ctx.user.id,
    },
  });
}

/**
 * Reverses every not-yet-reversed ledger entry posted for a document, by adding mirror entries
 * (debit ↔ credit) that point back with `reversalOfId`. Nothing is edited or deleted.
 */
export async function reverseLedgerFor(
  tx: TenantTx,
  ctx: ServiceCtx,
  reference: { type: string; id: string },
  entryDate: Date,
  description: string,
) {
  const entries = await tx.ledgerEntry.findMany({
    where: {
      referenceType: reference.type,
      referenceId: reference.id,
      type: { not: "REVERSAL" },
      reversedBy: { none: {} },
    },
  });
  for (const e of entries) {
    await tx.ledgerEntry.create({
      data: {
        tenantId: ctx.user.tenantId,
        partyType: e.partyType,
        customerId: e.customerId,
        companyId: e.companyId,
        staffId: e.staffId,
        type: "REVERSAL",
        entryDate,
        debit: e.credit,
        credit: e.debit,
        description,
        referenceType: e.referenceType,
        referenceId: e.referenceId,
        reversalOfId: e.id,
        createdById: ctx.user.id,
      },
    });
  }
  return entries.length;
}

/** Quantity left in each batch (sum of its movements), in base units. */
export async function batchBalances(
  tx: TenantTx,
  batchIds: string[],
): Promise<Map<string, number>> {
  if (batchIds.length === 0) return new Map();
  const groups = await tx.stockMovement.groupBy({
    by: ["batchId"],
    where: { batchId: { in: batchIds }, bucket: "SALEABLE" },
    _sum: { quantity: true },
  });
  return new Map(groups.map((g) => [g.batchId!, g._sum.quantity ?? 0]));
}

/** Loads a record or fails with a readable "not found" (another tenant's id is simply not found). */
export function found<T>(record: T | null, label: string): T {
  if (!record) throw new ServiceError(`This ${label} was not found.`);
  return record;
}
