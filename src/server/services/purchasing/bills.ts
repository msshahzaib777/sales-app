import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { businessToday } from "@/lib/dates";
import { dueDateSchema } from "@/lib/validation/purchasing";
import { icontains, matchEveryWord, searchNumber } from "@/lib/list-params";

import { writeAudit } from "../../audit";
import { assertCan } from "../../auth/permissions";
import type { TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";
import { PAGE_SIZE, paged, type ServiceCtx } from "../master/common";
import { found } from "../posting";
import { billState, type BillState, type OpenBill } from "./calc";
import type { DateRange } from "./filters";

// Company bills: created by goods receipts. Paid / partial / unpaid / overdue is derived from
// allocations of posted payments and the due date; it is never stored.

type Reader = Pick<TenantTx, "companyPaymentAllocation">;

/** Paid amount per bill (allocations of posted payments only). */
export async function paidByBill(tx: Reader, billIds: string[]) {
  if (billIds.length === 0) return new Map<string, Prisma.Decimal>();
  const groups = await tx.companyPaymentAllocation.groupBy({
    by: ["companyBillId"],
    where: { companyBillId: { in: billIds }, companyPayment: { status: "POSTED" } },
    _sum: { amount: true },
  });
  return new Map(groups.map((g) => [g.companyBillId, g._sum.amount ?? new Prisma.Decimal(0)]));
}

export const BILL_FILTERS = ["open", "overdue", "paid", "all"] as const;
export type BillFilter = (typeof BILL_FILTERS)[number];

export type BillRow = {
  id: string;
  number: number;
  companyId: string;
  companyName: string;
  billDate: Date;
  dueDate: Date;
  netAmount: Prisma.Decimal;
  /** Null for the opening-balance bill. */
  receiptNumber: number | null;
} & BillState;

/** Bills with their state; `filter` works on the derived status. */
export async function listCompanyBills(
  ctx: ServiceCtx,
  f: { companyId?: string; q?: string; filter: BillFilter; page: number } & DateRange,
) {
  assertCan(ctx.user.role, "ledgers.view");
  const rows = await ctx.db.companyBill.findMany({
    where: {
      ...(f.companyId ? { companyId: f.companyId } : {}),
      ...(f.filter !== "all" ? { status: "POSTED" } : {}),
      ...(searchNumber(f.q) !== undefined
        ? { number: searchNumber(f.q) }
        : matchEveryWord(f.q, (w) => [{ company: { name: icontains(w) } }])),
      ...(f.from || f.to
        ? { billDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
        : {}),
    },
    orderBy: [{ dueDate: "asc" }, { number: "asc" }],
    include: { company: { select: { name: true } }, goodsReceipt: { select: { number: true } } },
  });
  const paid = await paidByBill(
    ctx.db,
    rows.map((r) => r.id),
  );
  const today = businessToday();
  const withState: BillRow[] = rows.map((b) => ({
    id: b.id,
    number: b.number,
    companyId: b.companyId,
    companyName: b.company.name,
    billDate: b.billDate,
    dueDate: b.dueDate,
    netAmount: b.netAmount,
    receiptNumber: b.goodsReceipt?.number ?? null,
    ...billState(b, paid.get(b.id) ?? 0, today),
  }));
  const filtered = withState.filter((b) =>
    f.filter === "open"
      ? b.outstanding.gt(0)
      : f.filter === "overdue"
        ? b.overdue
        : f.filter === "paid"
          ? b.status === "PAID"
          : true,
  );
  const totals = {
    outstanding: filtered.reduce((s, b) => s.add(b.outstanding), new Prisma.Decimal(0)),
    overdue: filtered
      .filter((b) => b.overdue)
      .reduce((s, b) => s.add(b.outstanding), new Prisma.Decimal(0)),
  };
  const page = filtered.slice((f.page - 1) * PAGE_SIZE, f.page * PAGE_SIZE);
  return { ...paged(page, filtered.length, f.page), totals };
}

/** Open (outstanding > 0) posted bills of one company, for payment allocation. */
export async function openBillsFor(
  tx: TenantTx | ServiceCtx["db"],
  companyId: string,
): Promise<(OpenBill & { netAmount: Prisma.Decimal; isOpening: boolean })[]> {
  const bills = await tx.companyBill.findMany({ where: { companyId, status: "POSTED" } });
  const paid = await paidByBill(
    tx,
    bills.map((b) => b.id),
  );
  return bills
    .map((b) => ({
      id: b.id,
      number: b.number,
      billDate: b.billDate,
      dueDate: b.dueDate,
      netAmount: b.netAmount,
      isOpening: b.kind === "OPENING_BALANCE",
      outstanding: b.netAmount.sub(paid.get(b.id) ?? 0),
    }))
    .filter((b) => b.outstanding.gt(0));
}

export async function getCompanyBill(ctx: ServiceCtx, id: string) {
  assertCan(ctx.user.role, "ledgers.view");
  const bill = found(
    await ctx.db.companyBill.findUnique({
      where: { id },
      include: {
        company: { select: { name: true } },
        goodsReceipt: {
          select: {
            id: true,
            number: true,
            supplierRef: true,
            lines: {
              include: { product: { select: { code: true, name: true } } },
              orderBy: { product: { code: "asc" } },
            },
          },
        },
        appliedClaims: {
          include: { product: { select: { name: true } } },
          orderBy: { claimDate: "asc" },
        },
        allocations: {
          include: {
            companyPayment: {
              select: { id: true, number: true, paymentDate: true, method: true, status: true },
            },
          },
          orderBy: { companyPayment: { paymentDate: "asc" } },
        },
      },
    }),
    "company bill",
  );
  const paid = bill.allocations
    .filter((a) => a.companyPayment.status === "POSTED")
    .reduce((s, a) => s.add(a.amount), new Prisma.Decimal(0));
  return { ...bill, state: billState(bill, paid, businessToday()) };
}

export async function updateBillDueDate(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "payments.manage");
  const { billId, dueDate } = dueDateSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const bill = found(await tx.companyBill.findUnique({ where: { id: billId } }), "company bill");
    if (bill.status !== "POSTED") throw new ServiceError("This bill was cancelled.");
    if (dueDate < bill.billDate)
      throw new ServiceError("The due date cannot be before the bill date.");
    const after = await tx.companyBill.update({ where: { id: billId }, data: { dueDate } });
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "CompanyBill",
      entityId: billId,
      oldValue: { dueDate: bill.dueDate },
      newValue: { dueDate },
    });
    return after;
  });
}
