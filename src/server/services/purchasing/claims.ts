import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { ClaimStatus, ClaimType } from "@/generated/prisma/enums";
import { businessToday } from "@/lib/dates";
import { PACKETS_PER_DOZEN } from "@/lib/units";
import { claimSchema, reverseSchema, settleClaimSchema } from "@/lib/validation/purchasing";

import { writeAudit } from "../../audit";
import { assertCan, can } from "../../auth/permissions";
import type { TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";
import { PAGE_SIZE, paged, type ServiceCtx } from "../master/common";
import { found, nextDocumentNumber, postCompanyLedger, reverseLedgerFor } from "../posting";
import { calculateLineAmounts } from "@/lib/pricing";
import type { DateRange } from "./filters";

// Company claims (damage in delivery, damaged stock returned, other): a credit against the
// company, valued at purchase cost (owner's answer, SPEC §17).
// - Damage in delivery is logged by day-end entry (delivery/day-end.ts), which also moves the
//   stock. It waits (AWAITING, no money) until the user settles it with the company: accepted in
//   full or for less (credit posted, PENDING), or rejected (REJECTED, nothing posted).
// - A claim logged by hand on the claims screen is posted at once (PENDING).
// The company's next bill deducts PENDING claims (goods-receipts.ts), which makes them APPLIED.

const STATUSES: ClaimStatus[] = ["AWAITING", "PENDING", "APPLIED", "REJECTED", "REVERSED"];

export async function listClaims(
  ctx: ServiceCtx,
  f: { companyId?: string; status?: string; q?: string; page: number } & DateRange,
) {
  assertCan(ctx.user.role, "payments.manage");
  const where: Prisma.CompanyClaimWhereInput = {
    ...(f.companyId ? { companyId: f.companyId } : {}),
    ...(f.q
      ? /^\d+$/.test(f.q)
        ? { number: Number(f.q) }
        : {
            OR: [
              { product: { name: { contains: f.q, mode: "insensitive" } } },
              { product: { code: { contains: f.q, mode: "insensitive" } } },
              { note: { contains: f.q, mode: "insensitive" } },
            ],
          }
      : {}),
    ...(f.status && STATUSES.includes(f.status as ClaimStatus)
      ? { status: f.status as ClaimStatus }
      : {}),
    ...(f.from || f.to
      ? { claimDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
      : {}),
  };
  const [rows, total] = await Promise.all([
    ctx.db.companyClaim.findMany({
      where,
      orderBy: [{ claimDate: "desc" }, { number: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        company: { select: { name: true } },
        product: { select: { code: true, name: true } },
        appliedToBill: { select: { id: true, number: true } },
      },
    }),
    ctx.db.companyClaim.count({ where }),
  ]);
  return paged(rows, total, f.page);
}

export async function createClaim(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "payments.manage");
  const data = claimSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    if (data.requestId) {
      const existing = await tx.companyClaim.findUnique({
        where: { tenantId_requestId: { tenantId: ctx.user.tenantId, requestId: data.requestId } },
      });
      if (existing) return existing;
    }
    const product = await tx.product.findUnique({ where: { id: data.productId } });
    if (!product || product.companyId !== data.companyId)
      throw new ServiceError("Choose a product of this company.");
    const rate =
      can(ctx.user.role, "financials.view") && data.rate !== null
        ? new Prisma.Decimal(data.rate)
        : product.purchaseRate;
    const amount = calculateLineAmounts({
      quantity: data.quantity,
      baseUnitsPerPriceUnit: PACKETS_PER_DOZEN,
      rate,
    }).netAmount;
    if (amount.lte(0)) throw new ServiceError("The claim amount must be more than zero.");

    const claim = await logClaim(tx, ctx, {
      companyId: data.companyId,
      product,
      type: data.type,
      claimDate: data.claimDate,
      quantity: data.quantity,
      rate,
      amount,
      note: data.note,
      requestId: data.requestId,
    });
    await writeAudit(tx, ctx.user, {
      action: "POST",
      entityType: "CompanyClaim",
      entityId: claim.id,
      newValue: claim,
      requestId: data.requestId,
    });
    return claim;
  });
}

/**
 * Saves a claim inside the caller's transaction and posts its credit to the company ledger, or,
 * with `awaiting`, leaves it for the user to settle (day-end damage).
 */
export async function logClaim(
  tx: TenantTx,
  ctx: ServiceCtx,
  c: {
    companyId: string;
    product: { id: string; name: string };
    type: ClaimType;
    claimDate: Date;
    quantity: number;
    rate: Prisma.Decimal;
    amount: Prisma.Decimal;
    note: string | null;
    salesOrderId?: string;
    requestId?: string;
    /** Wait for settlement with the company before any money moves. */
    awaiting?: boolean;
  },
) {
  const claim = await tx.companyClaim.create({
    data: {
      tenantId: ctx.user.tenantId,
      number: await nextDocumentNumber(tx, ctx, "COMPANY_CLAIM"),
      companyId: c.companyId,
      productId: c.product.id,
      type: c.type,
      claimDate: c.claimDate,
      quantity: c.quantity,
      rate: c.rate,
      amount: c.amount,
      claimedAmount: c.amount,
      status: c.awaiting ? "AWAITING" : "PENDING",
      salesOrderId: c.salesOrderId ?? null,
      note: c.note,
      requestId: c.requestId,
      createdById: ctx.user.id,
    },
  });
  if (!c.awaiting) await postClaimCredit(tx, ctx, claim, c.product.name, c.claimDate);
  return claim;
}

async function postClaimCredit(
  tx: TenantTx,
  ctx: ServiceCtx,
  claim: {
    id: string;
    number: number;
    companyId: string;
    amount: Prisma.Decimal;
    note: string | null;
  },
  productName: string,
  date: Date,
) {
  await postCompanyLedger(tx, ctx, {
    companyId: claim.companyId,
    type: "COMPANY_CLAIM",
    entryDate: date,
    debit: claim.amount,
    description: `Claim #${claim.number}: ${productName}${claim.note ? ` (${claim.note})` : ""}`,
    referenceType: "CompanyClaim",
    referenceId: claim.id,
  });
}

/**
 * Settles a day-end damage claim with the company: accept it in full, accept a smaller amount, or
 * reject it. Accepting posts the credit (deducted on the company's next bill); rejecting moves no
 * money. The damaged stock stays in the damaged bucket either way.
 */
export async function settleClaim(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "payments.manage");
  const data = settleClaimSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const claim = found(
      await tx.companyClaim.findUnique({
        where: { id: data.id },
        include: { product: { select: { name: true } } },
      }),
      "claim",
    );
    if (claim.status !== "AWAITING") throw new ServiceError("This claim is already settled.");
    const claimed = claim.claimedAmount ?? claim.amount;
    const today = businessToday();
    const settled = { settledAt: new Date(), settledById: ctx.user.id, settlementNote: data.note };
    let after;
    if (data.decision === "REJECT") {
      after = await tx.companyClaim.update({
        where: { id: claim.id },
        data: { status: "REJECTED", ...settled },
      });
    } else {
      const amount = data.decision === "ACCEPT" ? claimed : new Prisma.Decimal(data.amount!);
      if (amount.lte(0)) throw new ServiceError("Enter the amount the company accepted.");
      if (amount.gt(claimed))
        throw new ServiceError(
          `The company can't accept more than the ${claimed.toFixed(2)} claimed.`,
        );
      after = await tx.companyClaim.update({
        where: { id: claim.id },
        data: { status: "PENDING", amount, ...settled },
      });
      await postClaimCredit(tx, ctx, after, claim.product.name, today);
    }
    await writeAudit(tx, ctx.user, {
      action: data.decision === "REJECT" ? "REJECT" : "APPROVE",
      entityType: "CompanyClaim",
      entityId: claim.id,
      oldValue: { status: "AWAITING", claimedAmount: claimed },
      newValue: { status: after.status, amount: after.amount, note: data.note },
    });
    return after;
  });
}

/**
 * Cancels a claim that is waiting for settlement or for the next bill (already deducted claims
 * stay; the bill was built with them).
 */
export async function cancelClaim(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "payments.manage");
  const { id, reason } = reverseSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const claim = found(await tx.companyClaim.findUnique({ where: { id } }), "claim");
    if (claim.status !== "PENDING" && claim.status !== "AWAITING") {
      throw new ServiceError(
        claim.status === "APPLIED"
          ? "This claim was already deducted on a bill."
          : claim.status === "REJECTED"
            ? "This claim was rejected; nothing to cancel."
            : "This claim is already cancelled.",
      );
    }
    await reverseLedgerFor(
      tx,
      ctx,
      { type: "CompanyClaim", id },
      businessToday(),
      `Cancelled claim #${claim.number}: ${reason}`,
    );
    const after = await tx.companyClaim.update({
      where: { id },
      data: { status: "REVERSED", reversedAt: new Date() },
    });
    await writeAudit(tx, ctx.user, {
      action: "REVERSE",
      entityType: "CompanyClaim",
      entityId: id,
      oldValue: { status: claim.status },
      newValue: { status: "REVERSED", reason },
    });
    return after;
  });
}
