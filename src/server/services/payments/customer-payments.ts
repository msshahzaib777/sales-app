import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { PaymentCollectedVia, PaymentMethod } from "@/generated/prisma/enums";
import { splitByWeight } from "@/lib/delivery";

import type { TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";
import type { ServiceCtx } from "../master/common";
import { nextDocumentNumber } from "../posting";
import { customerPending } from "../sales/positions";

// Customer payments (SPEC §8). The customer ledger is a running balance, so a payment is split
// across companies in proportion to what the customer owes each company, then applied within each
// company to its oldest unpaid bill slices. Whatever no bill slice takes (opening balance, advance)
// still credits that company's ledger.

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

type SnapshotCompany = { companyId: string; netAmount: string };

/** Unpaid amount of each posted bill, per company slice, oldest first. */
export async function openBillSlices(tx: TenantTx, customerId: string) {
  const bills = await tx.bill.findMany({
    where: { customerId, status: "POSTED", postedAt: { not: null } },
    orderBy: [{ billDate: "asc" }, { number: "asc" }],
    include: { revisions: { orderBy: { revision: "desc" }, take: 1 } },
  });
  const paid = await tx.paymentAllocation.groupBy({
    by: ["billId", "companyId"],
    where: {
      billId: { in: bills.map((b) => b.id) },
      customerPayment: { status: "POSTED" },
    },
    _sum: { amount: true },
  });
  const paidKey = new Map(paid.map((p) => [`${p.billId}:${p.companyId}`, p._sum.amount ?? D(0)]));
  return bills.flatMap((b) =>
    (b.revisions[0]!.companyTotals as SnapshotCompany[])
      .map((c) => ({
        billId: b.id,
        billNumber: b.number,
        companyId: c.companyId,
        outstanding: D(c.netAmount).sub(paidKey.get(`${b.id}:${c.companyId}`) ?? 0),
      }))
      .filter((s) => s.outstanding.gt(0)),
  );
}

export type CustomerPaymentPost = {
  customerId: string;
  paymentDate: Date;
  method: PaymentMethod;
  amount: Prisma.Decimal;
  reference?: string | null;
  cheque?: { chequeNo: string; bankName: string; chequeDate: Date };
  collectedVia: PaymentCollectedVia;
  salesOrderId?: string;
  note?: string | null;
  requestId?: string;
  /** Used to split the payment when the customer owes no company anything (an advance). */
  fallbackCompanies?: [string, Prisma.Decimal][];
};

/** Saves one payment, its allocations and its ledger credits, inside the caller's transaction. */
export async function postCustomerPayment(tx: TenantTx, ctx: ServiceCtx, p: CustomerPaymentPost) {
  if (p.amount.lte(0)) throw new ServiceError("The amount must be more than zero.");
  const pending = await customerPending(tx, p.customerId);
  let weights: [string, Prisma.Decimal][] = [...pending.byCompany].filter(([, v]) => v.gt(0));
  if (weights.length === 0) weights = p.fallbackCompanies ?? [...pending.byCompany];
  if (weights.length === 0)
    throw new ServiceError(
      "This customer has no bills yet, so the payment has no company to go to.",
    );
  const shares = splitByWeight(p.amount, weights);

  const cheque = p.cheque
    ? await tx.cheque.create({
        data: {
          tenantId: ctx.user.tenantId,
          direction: "RECEIVED",
          chequeNo: p.cheque.chequeNo,
          bankName: p.cheque.bankName,
          chequeDate: p.cheque.chequeDate,
          amount: p.amount,
        },
      })
    : null;
  const payment = await tx.customerPayment.create({
    data: {
      tenantId: ctx.user.tenantId,
      number: await nextDocumentNumber(tx, ctx, "CUSTOMER_PAYMENT"),
      customerId: p.customerId,
      paymentDate: p.paymentDate,
      method: p.method,
      amount: p.amount,
      reference: p.reference ?? null,
      chequeId: cheque?.id ?? null,
      collectedVia: p.collectedVia,
      salesOrderId: p.salesOrderId ?? null,
      note: p.note ?? null,
      requestId: p.requestId,
      createdById: ctx.user.id,
    },
  });

  const slices = await openBillSlices(tx, p.customerId);
  const allocations: { billId: string; companyId: string; amount: Prisma.Decimal }[] = [];
  for (const [companyId, share] of shares) {
    let left = D(share.toString());
    for (const s of slices.filter((x) => x.companyId === companyId)) {
      if (left.lte(0)) break;
      const take = Prisma.Decimal.min(left, s.outstanding);
      allocations.push({ billId: s.billId, companyId, amount: take });
      left = left.sub(take);
    }
    const label =
      p.method === "CHEQUE"
        ? `Cheque ${p.cheque!.chequeNo} (${p.cheque!.bankName})`
        : p.method === "ONLINE"
          ? `Online${p.reference ? ` ${p.reference}` : ""}`
          : "Cash";
    await tx.ledgerEntry.create({
      data: {
        tenantId: ctx.user.tenantId,
        partyType: "CUSTOMER",
        customerId: p.customerId,
        companyId,
        type: "CUSTOMER_PAYMENT",
        entryDate: p.paymentDate,
        credit: D(share.toString()),
        description: `${label} received, payment #${payment.number}`,
        referenceType: "CustomerPayment",
        referenceId: payment.id,
        createdById: ctx.user.id,
      },
    });
  }
  if (allocations.length > 0) {
    await tx.paymentAllocation.createMany({
      data: allocations.map((a) => ({
        tenantId: ctx.user.tenantId,
        customerPaymentId: payment.id,
        ...a,
      })),
    });
  }
  return {
    payment,
    shares: [...shares].map(([companyId, amount]) => ({ companyId, amount: D(amount.toString()) })),
    allocations,
  };
}
