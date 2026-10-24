import "server-only";

import { type ListParams, searchWhere, statusWhere } from "@/lib/list-params";
import { warehouseSchema } from "@/lib/validation/master";

import { writeAudit } from "../../audit";
import { assertCan } from "../../auth/permissions";
import { ServiceError } from "../errors";
import { changedFields, PAGE_SIZE, paged, type ServiceCtx, withUniqueMessage } from "./common";

const DUPLICATE = "A warehouse with this name already exists.";

export async function listWarehouses(ctx: ServiceCtx, params: ListParams) {
  assertCan(ctx.user.role, "masterData.manage");
  const where = { ...statusWhere(params.status), ...searchWhere(params.q, ["name", "address"]) };
  const [rows, total] = await Promise.all([
    ctx.db.warehouse.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { _count: { select: { companies: true, areas: true } } },
    }),
    ctx.db.warehouse.count({ where }),
  ]);
  return paged(rows, total, params.page);
}

/** Active warehouses for dropdowns. */
export function warehouseOptions(ctx: ServiceCtx) {
  return ctx.db.warehouse.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export async function getWarehouse(ctx: ServiceCtx, id: string) {
  assertCan(ctx.user.role, "masterData.manage");
  const row = await ctx.db.warehouse.findUnique({ where: { id } });
  if (!row) throw new ServiceError("This warehouse was not found.");
  return row;
}

export async function createWarehouse(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "masterData.manage");
  const { requestId, ...data } = warehouseSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    if (requestId) {
      const existing = await tx.warehouse.findUnique({
        where: { tenantId_requestId: { tenantId: ctx.user.tenantId, requestId } },
      });
      if (existing) return existing;
    }
    const created = await withUniqueMessage(DUPLICATE, () =>
      tx.warehouse.create({ data: { tenantId: ctx.user.tenantId, requestId, ...data } }),
    );
    await writeAudit(tx, ctx.user, {
      action: "CREATE",
      entityType: "Warehouse",
      entityId: created.id,
      newValue: created,
      requestId,
    });
    return created;
  });
}

export async function updateWarehouse(ctx: ServiceCtx, id: string, input: unknown) {
  assertCan(ctx.user.role, "masterData.manage");
  const { requestId: _ignored, ...data } = warehouseSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.warehouse.findUnique({ where: { id } });
    if (!before) throw new ServiceError("This warehouse was not found.");
    const after = await withUniqueMessage(DUPLICATE, () =>
      tx.warehouse.update({ where: { id }, data }),
    );
    const diff = changedFields(before, after);
    if (diff.changed)
      await writeAudit(tx, ctx.user, {
        action: "UPDATE",
        entityType: "Warehouse",
        entityId: id,
        ...diff,
      });
    return after;
  });
}
