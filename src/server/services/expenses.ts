import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { PaymentMethod, PostingStatus } from "@/generated/prisma/enums";
import { businessToday } from "@/lib/dates";
import { BOOKER_SALARY_CATEGORY } from "@/lib/expenses";
import { icontains, matchEveryWord, searchNumber } from "@/lib/list-params";
import { expenseCategorySchema, expenseSchema } from "@/lib/validation/expenses";
import { recordIdSchema } from "@/lib/validation/master";
import { reverseSchema } from "@/lib/validation/purchasing";

import { writeAudit } from "../audit";
import { assertCan } from "../auth/permissions";
import { ServiceError } from "./errors";
import { PAGE_SIZE, paged, type ServiceCtx } from "./master/common";
import { found, nextDocumentNumber, reverseLedgerFor } from "./posting";
import { logClaim } from "./purchasing/claims";
import type { DateRange } from "./purchasing/filters";

// Expenses (SPEC §9): money the business spends, by category, with optional links to a warehouse,
// bike, trip or staff member so reports can show petrol per bike and trip, and so on. A posted
// expense is never edited or deleted; a mistake is reversed with a reason and stays in the list.
// Owner and accountant only (expenses.manage).
//
// An expense paid for a company (its order booker's salary, or another expense of the company we
// distribute for) is charged back at once: a company claim for the amount, which lowers what we
// owe the company and is deducted on its next bill. The money still left our cash like any
// expense, but it is not our cost, so profit leaves it out.

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

export type ExpenseFilters = {
  q?: string;
  categoryId?: string;
  method?: string;
  warehouseId?: string;
  bikeId?: string;
  status?: string;
  page: number;
} & DateRange;

const METHODS: PaymentMethod[] = ["CASH", "CHEQUE", "ONLINE"];
const STATUSES: PostingStatus[] = ["POSTED", "REVERSED"];
const pick = <T extends string>(list: T[], v?: string) =>
  v && list.includes(v as T) ? (v as T) : undefined;

function expenseWhere(f: Omit<ExpenseFilters, "page">): Prisma.ExpenseWhereInput {
  const number = searchNumber(f.q);
  return {
    ...(f.categoryId ? { categoryId: f.categoryId } : {}),
    ...(f.warehouseId ? { warehouseId: f.warehouseId } : {}),
    ...(f.bikeId ? { bikeId: f.bikeId } : {}),
    ...(pick(METHODS, f.method) ? { method: pick(METHODS, f.method) } : {}),
    ...(pick(STATUSES, f.status) ? { status: pick(STATUSES, f.status) } : {}),
    ...(f.from || f.to
      ? { expenseDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
      : {}),
    ...(number !== undefined
      ? { OR: [{ number }, { paidTo: { contains: String(number) } }] }
      : matchEveryWord(f.q, (w): Prisma.ExpenseWhereInput[] => [
          { note: icontains(w) },
          { paidTo: icontains(w) },
          { category: { name: icontains(w) } },
          { bike: { name: icontains(w) } },
          { staff: { name: icontains(w) } },
          { company: { name: icontains(w) } },
        ])),
  };
}

/** Expenses newest first, with the total and the total per category of everything filtered. */
export async function listExpenses(ctx: ServiceCtx, f: ExpenseFilters) {
  assertCan(ctx.user.role, "expenses.manage");
  const where = expenseWhere(f);
  const [rows, total, byCategory, categories] = await Promise.all([
    ctx.db.expense.findMany({
      where,
      orderBy: [{ expenseDate: "desc" }, { number: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: expenseInclude,
    }),
    ctx.db.expense.count({ where }),
    ctx.db.expense.groupBy({
      by: ["categoryId"],
      where: { AND: [where, { status: "POSTED" }] },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    ctx.db.expenseCategory.findMany({ select: { id: true, name: true } }),
  ]);
  const name = new Map(categories.map((c) => [c.id, c.name]));
  const totals = byCategory
    .map((g) => ({
      categoryId: g.categoryId,
      name: name.get(g.categoryId) ?? "",
      amount: g._sum.amount ?? D(0),
      count: g._count._all,
    }))
    .sort((a, b) => b.amount.comparedTo(a.amount) || a.name.localeCompare(b.name));
  return {
    ...paged(rows, total, f.page),
    totalAmount: totals.reduce((s, t) => s.add(t.amount), D(0)),
    byCategory: totals,
  };
}

const expenseInclude = {
  category: { select: { name: true } },
  warehouse: { select: { name: true } },
  bike: { select: { name: true } },
  trip: { select: { id: true, number: true, tripDate: true } },
  staff: { select: { name: true } },
  company: { select: { name: true } },
  claim: { select: { number: true, status: true } },
} satisfies Prisma.ExpenseInclude;

/** Every expense matching the filters (no paging), for the Excel export. */
export async function exportExpenses(ctx: ServiceCtx, f: Omit<ExpenseFilters, "page">) {
  assertCan(ctx.user.role, "expenses.manage");
  return ctx.db.expense.findMany({
    where: expenseWhere(f),
    orderBy: [{ expenseDate: "asc" }, { number: "asc" }],
    take: 10_000,
    include: expenseInclude,
  });
}

export async function createExpense(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "expenses.manage");
  const data = expenseSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    if (data.requestId) {
      const existing = await tx.expense.findUnique({
        where: { tenantId_requestId: { tenantId: ctx.user.tenantId, requestId: data.requestId } },
      });
      if (existing) return existing;
    }
    const company = data.companyId
      ? await tx.company.findUnique({ where: { id: data.companyId } })
      : null;
    if (data.chargeTo !== "OWN" && !company) throw new ServiceError("Choose the company again.");
    // A booker salary has its own category, made the first time.
    const category =
      data.chargeTo === "BOOKER_SALARY"
        ? ((await tx.expenseCategory.findFirst({
            where: { name: { equals: BOOKER_SALARY_CATEGORY, mode: "insensitive" } },
          })) ??
          (await tx.expenseCategory.create({
            data: { tenantId: ctx.user.tenantId, name: BOOKER_SALARY_CATEGORY },
          })))
        : await tx.expenseCategory.findUnique({ where: { id: data.categoryId! } });
    if (!category || (data.chargeTo !== "BOOKER_SALARY" && !category.isActive))
      throw new ServiceError("Choose an active category.");
    // The links must be this tenant's records (the tenant layer scopes these reads).
    const [warehouse, bike, trip, staff] = await Promise.all([
      data.warehouseId ? tx.warehouse.findUnique({ where: { id: data.warehouseId } }) : null,
      data.bikeId ? tx.bike.findUnique({ where: { id: data.bikeId } }) : null,
      data.tripId ? tx.deliveryTrip.findUnique({ where: { id: data.tripId } }) : null,
      data.staffId ? tx.staff.findUnique({ where: { id: data.staffId } }) : null,
    ]);
    if (data.warehouseId && !warehouse) throw new ServiceError("Choose the warehouse again.");
    if (data.bikeId && !bike) throw new ServiceError("Choose the bike again.");
    if (data.tripId && !trip) throw new ServiceError("Choose the trip again.");
    if (data.staffId && !staff) throw new ServiceError("Choose the staff member again.");

    const expense = await tx.expense.create({
      data: {
        tenantId: ctx.user.tenantId,
        number: await nextDocumentNumber(tx, ctx, "EXPENSE"),
        expenseDate: data.expenseDate,
        categoryId: category.id,
        amount: D(data.amount),
        method: data.method,
        // A trip's bike is the bike, unless another was chosen.
        warehouseId: data.warehouseId,
        bikeId: data.bikeId ?? trip?.bikeId ?? null,
        tripId: data.tripId,
        staffId: data.staffId,
        companyId: data.chargeTo === "OWN" ? null : company!.id,
        paidTo:
          data.paidTo ?? (data.chargeTo === "BOOKER_SALARY" ? company!.orderBookerName : null),
        note: data.note,
        requestId: data.requestId,
        createdById: ctx.user.id,
      },
    });
    let claimNumber: number | null = null;
    if (data.chargeTo !== "OWN") {
      const what = [
        data.chargeTo === "COMPANY_EXPENSE" ? category.name : null,
        expense.paidTo,
        `expense #${expense.number}`,
        data.note,
      ]
        .filter(Boolean)
        .join(", ");
      const claim = await logClaim(tx, ctx, {
        companyId: company!.id,
        product: null,
        type: data.chargeTo,
        claimDate: data.expenseDate,
        quantity: 1,
        rate: expense.amount,
        amount: expense.amount,
        note: what,
        expenseId: expense.id,
      });
      claimNumber = claim.number;
    }
    await writeAudit(tx, ctx.user, {
      action: "POST",
      entityType: "Expense",
      entityId: expense.id,
      newValue: { ...expense, category: category.name, chargedBack: claimNumber },
      requestId: data.requestId,
    });
    return expense;
  });
}

export async function reverseExpense(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "expenses.manage");
  const { id, reason } = reverseSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const expense = found(
      await tx.expense.findUnique({
        where: { id },
        include: { claim: { include: { appliedToBill: { select: { number: true } } } } },
      }),
      "expense",
    );
    // Charged back to a company: its claim is cancelled too, unless a bill already deducted it.
    const claim = expense.claim;
    if (claim?.status === "APPLIED")
      throw new ServiceError(
        `This expense was already taken off company bill #${claim.appliedToBill?.number} (claim #${claim.number}). Cancel that goods receipt first, or log a correction.`,
      );
    const claimed = await tx.expense.updateMany({
      where: { id, status: "POSTED" },
      data: { status: "REVERSED", reversedAt: new Date(), reversalReason: reason },
    });
    if (claimed.count === 0) throw new ServiceError("This expense is already reversed.");
    if (claim && claim.status === "PENDING") {
      await reverseLedgerFor(
        tx,
        ctx,
        { type: "CompanyClaim", id: claim.id },
        businessToday(),
        `Cancelled claim #${claim.number}: expense #${expense.number} reversed (${reason})`,
      );
      await tx.companyClaim.update({
        where: { id: claim.id },
        data: { status: "REVERSED", reversedAt: new Date() },
      });
    }
    await writeAudit(tx, ctx.user, {
      action: "REVERSE",
      entityType: "Expense",
      entityId: id,
      oldValue: { status: "POSTED", amount: expense.amount },
      newValue: { status: "REVERSED", reason },
    });
  });
}

/** Choices for the expense form and the list filters. */
export async function expenseFormOptions(ctx: ServiceCtx) {
  assertCan(ctx.user.role, "expenses.manage");
  const since = new Date(businessToday().getTime() - 30 * 86_400_000);
  const [categories, warehouses, bikes, staff, trips, companies] = await Promise.all([
    ctx.db.expenseCategory.findMany({ orderBy: { name: "asc" } }),
    ctx.db.warehouse.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    ctx.db.bike.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    ctx.db.staff.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    ctx.db.deliveryTrip.findMany({
      where: { tripDate: { gte: since } },
      orderBy: [{ tripDate: "desc" }, { number: "desc" }],
      take: 100,
      select: { id: true, number: true, tripDate: true, bike: { select: { name: true } } },
    }),
    ctx.db.company.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, orderBookerName: true },
    }),
  ]);
  return { categories, warehouses, bikes, staff, trips, companies };
}

// ───────────────────────── Categories ─────────────────────────

export async function createExpenseCategory(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "expenses.manage");
  const { name } = expenseCategorySchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const existing = await tx.expenseCategory.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
    });
    if (existing) {
      if (existing.isActive) throw new ServiceError(`"${existing.name}" already exists.`);
      throw new ServiceError(`"${existing.name}" exists but is switched off. Switch it on below.`);
    }
    const category = await tx.expenseCategory.create({
      data: { tenantId: ctx.user.tenantId, name },
    });
    await writeAudit(tx, ctx.user, {
      action: "CREATE",
      entityType: "ExpenseCategory",
      entityId: category.id,
      newValue: category,
    });
    return category;
  });
}

/** Switches a category off (no new expenses; old ones keep it) or back on. */
export async function setExpenseCategoryActive(ctx: ServiceCtx, input: unknown, active: boolean) {
  assertCan(ctx.user.role, "expenses.manage");
  const { id } = recordIdSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const category = found(await tx.expenseCategory.findUnique({ where: { id } }), "category");
    if (category.isActive === active) return category;
    const after = await tx.expenseCategory.update({ where: { id }, data: { isActive: active } });
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "ExpenseCategory",
      entityId: id,
      oldValue: { isActive: category.isActive },
      newValue: { isActive: active },
    });
    return after;
  });
}
