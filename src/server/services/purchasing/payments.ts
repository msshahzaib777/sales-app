import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { PaymentMethod } from "@/generated/prisma/enums";
import { businessToday } from "@/lib/dates";
import { companyPaymentSchema, reverseSchema } from "@/lib/validation/purchasing";

import { writeAudit } from "../../audit";
import { assertCan } from "../../auth/permissions";
import { ServiceError } from "../errors";
import { PAGE_SIZE, paged, type ServiceCtx } from "../master/common";
import { found, nextDocumentNumber, postCompanyLedger, reverseLedgerFor } from "../posting";
import { openBillsFor } from "./bills";
import { allocateOldestFirst, checkAllocations } from "./calc";
import type { DateRange } from "./filters";

// Company payments: full or partial, one payment can settle several bills. By default the amount
// goes to the oldest due bills first; the user can split it by hand instead. Anything not
// allocated stays as an advance (it still reduces the ledger balance).

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "cash",
  CHEQUE: "cheque",
  ONLINE: "online",
};

export async function listCompanyPayments(
  ctx: ServiceCtx,
  f: { companyId?: string; q?: string; page: number } & DateRange,
) {
  assertCan(ctx.user.role, "payments.manage");
  const number = f.q && /^\d+$/.test(f.q) ? Number(f.q) : undefined;
  const where: Prisma.CompanyPaymentWhereInput = {
    ...(f.companyId ? { companyId: f.companyId } : {}),
    ...(f.from || f.to
      ? { paymentDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
      : {}),
    ...(f.q
      ? number
        ? { number }
        : {
            OR: [
              { reference: { contains: f.q, mode: "insensitive" } },
              { company: { name: { contains: f.q, mode: "insensitive" } } },
            ],
          }
      : {}),
  };
  const [rows, total] = await Promise.all([
    ctx.db.companyPayment.findMany({
      where,
      orderBy: [{ paymentDate: "desc" }, { number: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        company: { select: { name: true } },
        cheque: true,
        allocations: { select: { amount: true } },
      },
    }),
    ctx.db.companyPayment.count({ where }),
  ]);
  return paged(
    rows.map(({ allocations, ...p }) => ({
      ...p,
      allocated: allocations.reduce((s, a) => s.add(a.amount), new Prisma.Decimal(0)),
    })),
    total,
    f.page,
  );
}

export async function getCompanyPayment(ctx: ServiceCtx, id: string) {
  assertCan(ctx.user.role, "payments.manage");
  return found(
    await ctx.db.companyPayment.findUnique({
      where: { id },
      include: {
        company: { select: { name: true } },
        cheque: true,
        allocations: {
          include: {
            companyBill: {
              select: { id: true, number: true, billDate: true, dueDate: true, netAmount: true },
            },
          },
        },
      },
    }),
    "payment",
  );
}

export async function createCompanyPayment(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "payments.manage");
  const data = companyPaymentSchema.parse(input);
  const amount = new Prisma.Decimal(data.amount);

  // Serializable: two payments entered at the same time must not both use up the same bill.
  return ctx.db.$transaction(
    async (tx) => {
      if (data.requestId) {
        const existing = await tx.companyPayment.findUnique({
          where: { tenantId_requestId: { tenantId: ctx.user.tenantId, requestId: data.requestId } },
        });
        if (existing) return existing;
      }
      const company = await tx.company.findUnique({ where: { id: data.companyId } });
      if (!company) throw new ServiceError("Choose a company.");

      const open = await openBillsFor(tx, company.id);
      const allocations =
        data.allocationMode === "auto"
          ? allocateOldestFirst(amount, open)
          : data.allocations.map((a) => ({
              billId: a.billId,
              amount: new Prisma.Decimal(a.amount),
            }));
      const errors = checkAllocations(amount, allocations, open);
      if (errors.length > 0) throw new ServiceError(errors.join(" "));

      const cheque =
        data.method === "CHEQUE"
          ? await tx.cheque.create({
              data: {
                tenantId: ctx.user.tenantId,
                direction: "ISSUED",
                chequeNo: data.chequeNo!,
                bankName: data.bankName!,
                chequeDate: data.chequeDate!,
                amount,
              },
            })
          : null;

      const payment = await tx.companyPayment.create({
        data: {
          tenantId: ctx.user.tenantId,
          number: await nextDocumentNumber(tx, ctx, "COMPANY_PAYMENT"),
          companyId: company.id,
          paymentDate: data.paymentDate,
          method: data.method,
          amount,
          reference: data.reference,
          chequeId: cheque?.id ?? null,
          note: data.note,
          requestId: data.requestId,
          createdById: ctx.user.id,
        },
      });
      if (allocations.length > 0) {
        await tx.companyPaymentAllocation.createMany({
          data: allocations.map((a) => ({
            tenantId: ctx.user.tenantId,
            companyPaymentId: payment.id,
            companyBillId: a.billId,
            companyId: company.id,
            amount: a.amount,
          })),
        });
      }
      const billNumbers = allocations.map((a) => `#${open.find((b) => b.id === a.billId)!.number}`);
      await postCompanyLedger(tx, ctx, {
        companyId: company.id,
        type: "COMPANY_PAYMENT",
        entryDate: data.paymentDate,
        debit: amount,
        description: `Payment #${payment.number} (${METHOD_LABEL[data.method]}${data.method === "CHEQUE" ? ` ${data.chequeNo}` : data.reference ? ` ${data.reference}` : ""})${billNumbers.length ? ` for bills ${billNumbers.join(", ")}` : ""}`,
        referenceType: "CompanyPayment",
        referenceId: payment.id,
      });
      await writeAudit(tx, ctx.user, {
        action: "POST",
        entityType: "CompanyPayment",
        entityId: payment.id,
        newValue: {
          ...payment,
          allocations: allocations.map((a) => ({ billId: a.billId, amount: a.amount })),
        },
        requestId: data.requestId,
      });
      return payment;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/** Reverses a payment entered by mistake or a bounced cheque; its bills become unpaid again. */
export async function reverseCompanyPayment(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "payments.manage");
  const { id, reason } = reverseSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const payment = found(await tx.companyPayment.findUnique({ where: { id } }), "payment");
    if (payment.status !== "POSTED") throw new ServiceError("This payment is already reversed.");
    await reverseLedgerFor(
      tx,
      ctx,
      { type: "CompanyPayment", id },
      businessToday(),
      `Reversed payment #${payment.number}: ${reason}`,
    );
    const after = await tx.companyPayment.update({
      where: { id },
      data: { status: "REVERSED", reversedAt: new Date(), reversalReason: reason },
    });
    await writeAudit(tx, ctx.user, {
      action: "REVERSE",
      entityType: "CompanyPayment",
      entityId: id,
      oldValue: { status: "POSTED" },
      newValue: { status: "REVERSED", reason },
    });
    return after;
  });
}

/** Open bills per company with outstanding amounts, for the payment form. */
export async function openBillsByCompany(ctx: ServiceCtx) {
  assertCan(ctx.user.role, "payments.manage");
  const companies = await ctx.db.company.findMany({ select: { id: true } });
  const result: Record<
    string,
    {
      id: string;
      number: number;
      isOpening: boolean;
      billDate: string;
      dueDate: string;
      outstanding: string;
    }[]
  > = {};
  for (const c of companies) {
    const bills = await openBillsFor(ctx.db, c.id);
    if (bills.length > 0) {
      result[c.id] = bills.map((b) => ({
        id: b.id,
        number: b.number,
        isOpening: b.isOpening,
        billDate: b.billDate.toISOString().slice(0, 10),
        dueDate: b.dueDate.toISOString().slice(0, 10),
        outstanding: new Prisma.Decimal(b.outstanding).toFixed(2),
      }));
    }
  }
  return result;
}
