import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type {
  ChequeStatus,
  PaymentCollectedVia,
  PaymentMethod,
  PostingStatus,
} from "@/generated/prisma/enums";
import { businessToday, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import {
  allocateByCompany,
  allocateOldestFirst,
  type BillDebt,
  checkCompanySplit,
  effectiveDebt,
} from "@/lib/payments";
import { recordIdSchema } from "@/lib/validation/master";
import { customerPaymentSchema } from "@/lib/validation/payments";
import { reverseSchema } from "@/lib/validation/purchasing";

import { writeAudit } from "../../audit";
import { assertCan } from "../../auth/permissions";
import type { TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";
import { PAGE_SIZE, paged, type ServiceCtx } from "../master/common";
import { found, nextDocumentNumber, reverseLedgerFor } from "../posting";
import type { DateRange } from "../purchasing/filters";
import { customerPending } from "../sales/positions";

// Customer payments (SPEC §8), at the office or collected at delivery (day-end). Allocation rules
// are in src/lib/payments.ts: oldest debt first (opening balance, then bills oldest first, a
// multi-company bill split by each company's unpaid amount), or a manual split by company. Each
// company's share credits that company's slice of the customer ledger.
// A bounced cheque reverses its payment (the debt comes back) and flags the customer.

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);
type Reader = TenantTx | ServiceCtx["db"];
type SnapshotCompany = { companyId: string; netAmount: string };

/** Everything the customer owes, bill by bill (posted bills, minus posted payments). */
export async function customerDebt(tx: Reader, customerId: string) {
  const [pending, bills] = await Promise.all([
    customerPending(tx, customerId),
    tx.bill.findMany({
      where: { customerId, status: "POSTED", postedAt: { not: null } },
      orderBy: [{ billDate: "asc" }, { number: "asc" }],
      include: { revisions: { orderBy: { revision: "desc" }, take: 1 } },
    }),
  ]);
  const paid = await tx.paymentAllocation.groupBy({
    by: ["billId", "companyId"],
    where: { billId: { in: bills.map((b) => b.id) }, customerPayment: { status: "POSTED" } },
    _sum: { amount: true },
  });
  const paidKey = new Map(paid.map((p) => [`${p.billId}:${p.companyId}`, p._sum.amount ?? D(0)]));
  const raw: (BillDebt & { billDate: Date })[] = bills.map((b) => ({
    billId: b.id,
    number: b.number,
    billDate: b.billDate,
    slices: (b.revisions[0]!.companyTotals as SnapshotCompany[])
      .map((c) => ({
        companyId: c.companyId,
        outstanding: D(c.netAmount)
          .sub(paidKey.get(`${b.id}:${c.companyId}`) ?? 0)
          .toString(),
      }))
      .filter((s) => D(s.outstanding).gt(0)),
  }));
  const debt = effectiveDebt(
    new Map([...pending.byCompany].map(([k, v]) => [k, v.toString()])),
    raw,
  );
  const lastBill = bills.at(-1);
  return {
    pending,
    debt,
    billDates: new Map(raw.map((b) => [b.billId, b.billDate])),
    /** Where an advance goes when nothing is owed: the companies of the latest bill. */
    lastBillCompanies: lastBill
      ? (lastBill.revisions[0]!.companyTotals as SnapshotCompany[]).map(
          (c) => [c.companyId, c.netAmount] as [string, string],
        )
      : [],
  };
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
  /** Manual split by company; otherwise oldest debt first. */
  perCompany?: Map<string, Prisma.Decimal>;
  /** Where an advance goes (default: the companies of the customer's latest bill). */
  fallbackCompanies?: [string, Prisma.Decimal][];
};

const methodLabel = (p: Pick<CustomerPaymentPost, "method" | "cheque" | "reference">) =>
  p.method === "CHEQUE"
    ? `Cheque ${p.cheque!.chequeNo} (${p.cheque!.bankName})`
    : p.method === "ONLINE"
      ? `Online${p.reference ? ` ${p.reference}` : ""}`
      : "Cash";

/** Saves one payment, its allocations and its ledger credits, inside the caller's transaction. */
export async function postCustomerPayment(tx: TenantTx, ctx: ServiceCtx, p: CustomerPaymentPost) {
  if (p.amount.lte(0)) throw new ServiceError("The amount must be more than zero.");
  const { debt, lastBillCompanies } = await customerDebt(tx, p.customerId);
  let split;
  if (p.perCompany) {
    const errors = checkCompanySplit(p.amount.toString(), p.perCompany);
    if (errors.length > 0) throw new ServiceError(errors.join(" "));
    split = allocateByCompany(p.perCompany, debt);
  } else {
    const advanceTo = (p.fallbackCompanies ?? lastBillCompanies).map(
      ([k, v]) => [k, v.toString()] as [string, string],
    );
    split = allocateOldestFirst(p.amount.toString(), debt, advanceTo);
    if (split.advance.gt(0) && advanceTo.length === 0)
      throw new ServiceError(
        'This customer owes nothing yet. Choose "Split by company" to say which company the advance is for.',
      );
  }

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
  for (const [companyId, share] of split.byCompany) {
    if (share.lte(0)) continue;
    await tx.ledgerEntry.create({
      data: {
        tenantId: ctx.user.tenantId,
        partyType: "CUSTOMER",
        customerId: p.customerId,
        companyId,
        type: "CUSTOMER_PAYMENT",
        entryDate: p.paymentDate,
        credit: D(share.toString()),
        description: `${methodLabel(p)} received, payment #${payment.number}`,
        referenceType: "CustomerPayment",
        referenceId: payment.id,
        createdById: ctx.user.id,
      },
    });
  }
  if (split.allocations.length > 0) {
    await tx.paymentAllocation.createMany({
      data: split.allocations.map((a) => ({
        tenantId: ctx.user.tenantId,
        customerPaymentId: payment.id,
        billId: a.billId,
        companyId: a.companyId,
        amount: D(a.amount.toString()),
      })),
    });
  }
  return {
    payment,
    shares: [...split.byCompany].map(([companyId, amount]) => ({
      companyId,
      amount: D(amount.toString()),
    })),
    allocations: split.allocations,
  };
}

// ───────────────────────── Office payments ─────────────────────────

export async function createCustomerPayment(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "payments.manage");
  const data = customerPaymentSchema.parse(input);
  // Serializable: two payments for one customer at the same time must not both take one bill.
  return ctx.db.$transaction(
    async (tx) => {
      if (data.requestId) {
        const existing = await tx.customerPayment.findUnique({
          where: { tenantId_requestId: { tenantId: ctx.user.tenantId, requestId: data.requestId } },
        });
        if (existing) return existing;
      }
      const customer = await tx.customer.findUnique({ where: { id: data.customerId } });
      if (!customer) throw new ServiceError("Choose the customer.");
      const { payment, shares, allocations } = await postCustomerPayment(tx, ctx, {
        customerId: customer.id,
        paymentDate: data.paymentDate,
        method: data.method,
        amount: D(data.amount),
        reference: data.method === "CHEQUE" ? null : data.reference,
        cheque:
          data.method === "CHEQUE"
            ? { chequeNo: data.chequeNo!, bankName: data.bankName!, chequeDate: data.chequeDate! }
            : undefined,
        collectedVia: "OFFICE",
        note: data.note,
        requestId: data.requestId,
        perCompany:
          data.allocationMode === "company"
            ? new Map(data.companyAmounts.map((c) => [c.companyId, D(c.amount)]))
            : undefined,
      });
      await writeAudit(tx, ctx.user, {
        action: "POST",
        entityType: "CustomerPayment",
        entityId: payment.id,
        newValue: { ...payment, shares, allocations },
        requestId: data.requestId,
      });
      return payment;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 },
  );
}

/** Undoes a payment: mirror ledger entries (the debt comes back) and its bills are unpaid again. */
async function reversePayment(
  tx: TenantTx,
  ctx: ServiceCtx,
  id: string,
  reason: string,
  type: "REVERSAL" | "CHEQUE_BOUNCE",
) {
  const payment = found(
    await tx.customerPayment.findUnique({ where: { id }, include: { cheque: true } }),
    "payment",
  );
  const claimed = await tx.customerPayment.updateMany({
    where: { id, status: "POSTED" },
    data: { status: "REVERSED", reversedAt: new Date(), reversalReason: reason },
  });
  if (claimed.count === 0) throw new ServiceError("This payment is already reversed.");
  await reverseLedgerFor(
    tx,
    ctx,
    { type: "CustomerPayment", id },
    businessToday(),
    `${type === "CHEQUE_BOUNCE" ? "Cheque bounced" : "Reversed"}: payment #${payment.number} (${reason})`,
    type,
  );
  return payment;
}

export async function reverseCustomerPayment(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "payments.manage");
  const { id, reason } = reverseSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const payment = await reversePayment(tx, ctx, id, reason, "REVERSAL");
    if (payment.cheque?.status === "CLEARED")
      throw new ServiceError("This cheque has cleared. Record a refund instead of reversing it.");
    await writeAudit(tx, ctx.user, {
      action: "REVERSE",
      entityType: "CustomerPayment",
      entityId: id,
      oldValue: { status: "POSTED" },
      newValue: { status: "REVERSED", reason },
    });
  });
}

async function pendingCheque(tx: TenantTx, paymentId: string) {
  const payment = found(
    await tx.customerPayment.findUnique({ where: { id: paymentId }, include: { cheque: true } }),
    "payment",
  );
  if (!payment.cheque) throw new ServiceError("This payment is not a cheque.");
  if (payment.status !== "POSTED") throw new ServiceError("This payment was reversed.");
  if (payment.cheque.status !== "PENDING")
    throw new ServiceError(`This cheque is already ${payment.cheque.status.toLowerCase()}.`);
  return { payment, cheque: payment.cheque };
}

export async function clearCheque(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "payments.manage");
  const { id } = recordIdSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const { cheque } = await pendingCheque(tx, id);
    await tx.cheque.update({
      where: { id: cheque.id },
      data: { status: "CLEARED", clearedAt: new Date() },
    });
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "Cheque",
      entityId: cheque.id,
      oldValue: { status: "PENDING" },
      newValue: { status: "CLEARED" },
    });
  });
}

/** Bounced cheque: reverses the payment, restores the balance and flags the customer. */
export async function bounceCheque(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "payments.manage");
  const { id, reason } = reverseSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const { payment, cheque } = await pendingCheque(tx, id);
    await reversePayment(tx, ctx, id, reason, "CHEQUE_BOUNCE");
    await tx.cheque.update({
      where: { id: cheque.id },
      data: { status: "BOUNCED", bouncedAt: new Date() },
    });
    const flagReason = `Cheque ${cheque.chequeNo} (${cheque.bankName}) for ${formatMoney(cheque.amount)} bounced on ${formatDate(businessToday())}: ${reason}`;
    await tx.customer.update({
      where: { id: payment.customerId },
      data: { isFlagged: true, flagReason },
    });
    await writeAudit(tx, ctx.user, {
      action: "REVERSE",
      entityType: "Cheque",
      entityId: cheque.id,
      oldValue: { status: "PENDING", payment: payment.number },
      newValue: { status: "BOUNCED", reason, customerFlagged: true },
    });
  });
}

// ───────────────────────── Reading ─────────────────────────

export type PaymentFilters = {
  q?: string;
  customerId?: string;
  method?: string;
  status?: string;
  cheque?: string;
  via?: string;
  page: number;
} & DateRange;

const METHODS: PaymentMethod[] = ["CASH", "CHEQUE", "ONLINE"];
const STATUSES: PostingStatus[] = ["POSTED", "REVERSED"];
const CHEQUE_STATUSES: ChequeStatus[] = ["PENDING", "CLEARED", "BOUNCED"];
const VIA: PaymentCollectedVia[] = ["OFFICE", "DELIVERY"];
const pick = <T extends string>(list: T[], v?: string) =>
  v && list.includes(v as T) ? (v as T) : undefined;

export async function listCustomerPayments(ctx: ServiceCtx, f: PaymentFilters) {
  assertCan(ctx.user.role, "payments.manage");
  const number = f.q && /^\d+$/.test(f.q) ? Number(f.q) : undefined;
  const chequeStatus = pick(CHEQUE_STATUSES, f.cheque);
  const where: Prisma.CustomerPaymentWhereInput = {
    ...(f.customerId ? { customerId: f.customerId } : {}),
    ...(pick(METHODS, f.method) ? { method: pick(METHODS, f.method) } : {}),
    ...(pick(STATUSES, f.status) ? { status: pick(STATUSES, f.status) } : {}),
    ...(pick(VIA, f.via) ? { collectedVia: pick(VIA, f.via) } : {}),
    ...(chequeStatus ? { cheque: { status: chequeStatus } } : {}),
    ...(f.from || f.to
      ? { paymentDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
      : {}),
    ...(f.q
      ? number
        ? { number }
        : {
            OR: [
              { customer: { name: { contains: f.q, mode: "insensitive" } } },
              { customer: { shopName: { contains: f.q, mode: "insensitive" } } },
              { reference: { contains: f.q, mode: "insensitive" } },
              { cheque: { chequeNo: { contains: f.q } } },
            ],
          }
      : {}),
  };
  const [rows, total, sum] = await Promise.all([
    ctx.db.customerPayment.findMany({
      where,
      orderBy: [{ paymentDate: "desc" }, { number: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        customer: { select: { name: true, shopName: true } },
        cheque: true,
      },
    }),
    ctx.db.customerPayment.count({ where }),
    ctx.db.customerPayment.aggregate({
      where: { AND: [where, { status: "POSTED" }] },
      _sum: { amount: true },
    }),
  ]);
  return { ...paged(rows, total, f.page), totalAmount: sum._sum.amount ?? D(0) };
}

export async function getCustomerPayment(ctx: ServiceCtx, id: string) {
  assertCan(ctx.user.role, "payments.manage");
  const p = found(
    await ctx.db.customerPayment.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, shopName: true } },
        cheque: true,
        salesOrder: { select: { id: true, number: true, tripId: true } },
        allocations: {
          include: {
            bill: { select: { id: true, number: true, billDate: true, salesOrderId: true } },
            company: { select: { name: true } },
          },
        },
      },
    }),
    "payment",
  );
  const shares = await ctx.db.ledgerEntry.findMany({
    where: { referenceType: "CustomerPayment", referenceId: id, type: "CUSTOMER_PAYMENT" },
    include: { company: { select: { name: true } } },
  });
  return {
    ...p,
    allocations: [...p.allocations].sort(
      (a, b) =>
        a.bill.billDate.getTime() - b.bill.billDate.getTime() || a.bill.number - b.bill.number,
    ),
    shares: shares.map((s) => ({
      companyId: s.companyId!,
      companyName: s.company?.name ?? "",
      amount: s.credit,
    })),
  };
}

/** The payment screen's view of a customer: what is owed per company and the open bills. */
export async function paymentContext(ctx: ServiceCtx, customerId: string) {
  assertCan(ctx.user.role, "payments.manage");
  const customer = found(
    await ctx.db.customer.findUnique({ where: { id: customerId } }),
    "customer",
  );
  const [{ pending, debt, billDates, lastBillCompanies }, companies] = await Promise.all([
    customerDebt(ctx.db, customerId),
    ctx.db.company.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const name = new Map(companies.map((c) => [c.id, c.name]));
  return {
    customer: {
      id: customer.id,
      name: customer.name,
      shopName: customer.shopName,
      isFlagged: customer.isFlagged,
      flagReason: customer.flagReason,
    },
    pending: pending.total.toFixed(2),
    companies: companies.map((c) => ({
      id: c.id,
      name: c.name,
      owed: (pending.byCompany.get(c.id) ?? D(0)).toFixed(2),
    })),
    unbilled: [...debt.unbilled].map(
      ([companyId, amount]) => [companyId, amount.toFixed(2)] as [string, string],
    ),
    bills: debt.bills.map((b) => ({
      billId: b.billId,
      number: b.number,
      billDate: billDates.get(b.billId)!.toISOString().slice(0, 10),
      slices: b.slices.map((s) => ({
        companyId: s.companyId,
        companyName: name.get(s.companyId) ?? "",
        outstanding: D(s.outstanding.toString()).toFixed(2),
      })),
    })),
    advanceTo: lastBillCompanies,
  };
}

export type PaymentContext = Awaited<ReturnType<typeof paymentContext>>;

/** Removes the "flagged" mark (e.g. after a bounced cheque was made good). */
export async function clearCustomerFlag(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "payments.manage");
  const { id } = recordIdSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const customer = found(await tx.customer.findUnique({ where: { id } }), "customer");
    if (!customer.isFlagged) throw new ServiceError("This customer is not flagged.");
    await tx.customer.update({ where: { id }, data: { isFlagged: false, flagReason: null } });
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "Customer",
      entityId: id,
      oldValue: { isFlagged: true, flagReason: customer.flagReason },
      newValue: { isFlagged: false },
    });
  });
}
