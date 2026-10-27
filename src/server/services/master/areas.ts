import "server-only";

import { filterParam, type ListParams, searchWhere, statusWhere } from "@/lib/list-params";
import { areaSchema } from "@/lib/validation/master";

import { writeAudit } from "../../audit";
import { assertCan } from "../../auth/permissions";
import { ServiceError } from "../errors";
import { changedFields, PAGE_SIZE, paged, type ServiceCtx, withUniqueMessage } from "./common";

const DUPLICATE = "This warehouse already has an area with this name.";

export async function listAreas(
  ctx: ServiceCtx,
  params: ListParams,
  filters: Record<string, unknown> = {},
) {
  assertCan(ctx.user.role, "masterData.manage");
  const warehouseId = filterParam(filters, "warehouseId");
  const where = {
    ...statusWhere(params.status),
    ...searchWhere(params.q, ["name"]),
    ...(warehouseId ? { warehouseId } : {}),
  };
  const [rows, total] = await Promise.all([
    ctx.db.area.findMany({
      where,
      orderBy: [{ warehouse: { name: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { warehouse: { select: { name: true } }, _count: { select: { customers: true } } },
    }),
    ctx.db.area.count({ where }),
  ]);
  return paged(rows, total, params.page);
}

/** Active areas for dropdowns, with their warehouse. */
export function areaOptions(ctx: ServiceCtx) {
  return ctx.db.area.findMany({
    where: { isActive: true },
    orderBy: [{ warehouse: { name: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, warehouse: { select: { name: true } } },
  });
}

/** Areas for a new customer typed on an order: the area decides the warehouse. */
export async function areasForOrders(ctx: ServiceCtx) {
  const rows = await ctx.db.area.findMany({
    where: { isActive: true, warehouse: { isActive: true } },
    orderBy: [{ warehouse: { name: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, warehouseId: true, warehouse: { select: { name: true } } },
  });
  return rows.map((a) => ({
    id: a.id,
    name: a.name,
    warehouseId: a.warehouseId,
    warehouseName: a.warehouse.name,
  }));
}

export async function getArea(ctx: ServiceCtx, id: string) {
  assertCan(ctx.user.role, "masterData.manage");
  const row = await ctx.db.area.findUnique({ where: { id } });
  if (!row) throw new ServiceError("This area was not found.");
  return row;
}

export async function createArea(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "masterData.manage");
  const { requestId, ...data } = areaSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    if (requestId) {
      const existing = await tx.area.findUnique({
        where: { tenantId_requestId: { tenantId: ctx.user.tenantId, requestId } },
      });
      if (existing) return existing;
    }
    const created = await withUniqueMessage(DUPLICATE, () =>
      tx.area.create({ data: { tenantId: ctx.user.tenantId, requestId, ...data } }),
    );
    await writeAudit(tx, ctx.user, {
      action: "CREATE",
      entityType: "Area",
      entityId: created.id,
      newValue: created,
      requestId,
    });
    return created;
  });
}

export async function updateArea(ctx: ServiceCtx, id: string, input: unknown) {
  assertCan(ctx.user.role, "masterData.manage");
  const { requestId: _ignored, ...data } = areaSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.area.findUnique({ where: { id } });
    if (!before) throw new ServiceError("This area was not found.");
    if (
      before.warehouseId !== data.warehouseId &&
      (await tx.customer.count({ where: { areaId: id } })) > 0
    ) {
      throw new ServiceError(
        "Move this area's customers to another area before changing its warehouse.",
      );
    }
    const after = await withUniqueMessage(DUPLICATE, () => tx.area.update({ where: { id }, data }));
    const diff = changedFields(before, after);
    if (diff.changed)
      await writeAudit(tx, ctx.user, {
        action: "UPDATE",
        entityType: "Area",
        entityId: id,
        ...diff,
      });
    return after;
  });
}
