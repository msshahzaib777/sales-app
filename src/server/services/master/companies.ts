import "server-only";

import { businessToday } from "@/lib/dates";
import { filterParam, type ListParams, searchWhere, statusWhere } from "@/lib/list-params";
import { companySchema } from "@/lib/validation/master";

import { writeAudit } from "../../audit";
import { assertCan, can } from "../../auth/permissions";
import { ServiceError } from "../errors";
import { changedFields, PAGE_SIZE, paged, type ServiceCtx, withUniqueMessage } from "./common";
import { companyPayables, getOpeningBalance, setOpeningBalance } from "./opening-balances";

const DUPLICATE = "A company with this name already exists.";

/** Company list. Everyone can see it (staff need bookers' phones); payables only with ledgers.view. */
export async function listCompanies(
  ctx: ServiceCtx,
  params: ListParams,
  filters: Record<string, unknown> = {},
) {
  const warehouseId = filterParam(filters, "warehouseId");
  const where = {
    ...statusWhere(params.status),
    ...searchWhere(params.q, [
      "name",
      "contactName",
      "orderBookerName",
      "phone",
      "orderBookerPhone",
    ]),
    ...(warehouseId ? { warehouseId } : {}),
  };
  const [rows, total] = await Promise.all([
    ctx.db.company.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { warehouse: { select: { name: true } }, _count: { select: { products: true } } },
    }),
    ctx.db.company.count({ where }),
  ]);
  const payables = can(ctx.user.role, "ledgers.view")
    ? await companyPayables(
        ctx.db,
        rows.map((r) => r.id),
      )
    : null;
  return paged(
    rows.map((row) => ({
      ...row,
      payable: payables ? (payables.get(row.id)?.toFixed(2) ?? "0.00") : null,
    })),
    total,
    params.page,
  );
}

/** Active companies for dropdowns. */
export function companyOptions(ctx: ServiceCtx) {
  return ctx.db.company.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, warehouseId: true, warehouse: { select: { name: true } } },
  });
}

export async function getCompany(ctx: ServiceCtx, id: string) {
  assertCan(ctx.user.role, "masterData.manage");
  const row = await ctx.db.company.findUnique({ where: { id } });
  if (!row) throw new ServiceError("This company was not found.");
  const openingBalance = await getOpeningBalance(ctx.db, { kind: "COMPANY", companyId: id });
  return { ...row, openingBalance: openingBalance.toFixed(2) };
}

export async function createCompany(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "masterData.manage");
  const { requestId, openingBalance, ...data } = companySchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    if (requestId) {
      const existing = await tx.company.findUnique({
        where: { tenantId_requestId: { tenantId: ctx.user.tenantId, requestId } },
      });
      if (existing) return existing;
    }
    const created = await withUniqueMessage(DUPLICATE, () =>
      tx.company.create({ data: { tenantId: ctx.user.tenantId, requestId, ...data } }),
    );
    await setOpeningBalance(
      tx,
      ctx,
      { kind: "COMPANY", companyId: created.id },
      openingBalance,
      businessToday(),
    );
    await writeAudit(tx, ctx.user, {
      action: "CREATE",
      entityType: "Company",
      entityId: created.id,
      newValue: { ...created, openingBalance },
      requestId,
    });
    return created;
  });
}

export async function updateCompany(ctx: ServiceCtx, id: string, input: unknown) {
  assertCan(ctx.user.role, "masterData.manage");
  const { requestId: _ignored, openingBalance, ...data } = companySchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.company.findUnique({ where: { id } });
    if (!before) throw new ServiceError("This company was not found.");
    if (before.warehouseId !== data.warehouseId) {
      const used =
        (await tx.goodsReceipt.count({ where: { companyId: id } })) +
        (await tx.salesOrderLine.count({ where: { companyId: id } }));
      if (used > 0)
        throw new ServiceError(
          "This company already has purchases or orders, so its warehouse cannot change.",
        );
    }
    const after = await withUniqueMessage(DUPLICATE, () =>
      tx.company.update({ where: { id }, data }),
    );
    const opening = await setOpeningBalance(
      tx,
      ctx,
      { kind: "COMPANY", companyId: id },
      openingBalance,
      businessToday(),
    );
    const diff = changedFields(before, after);
    if (opening) {
      diff.oldValue.openingBalance = opening.from;
      diff.newValue.openingBalance = opening.to;
    }
    if (diff.changed || opening)
      await writeAudit(tx, ctx.user, {
        action: "UPDATE",
        entityType: "Company",
        entityId: id,
        oldValue: diff.oldValue,
        newValue: diff.newValue,
      });
    return after;
  });
}
