import "server-only";

import { type ListParams, searchWhere, statusWhere } from "@/lib/list-params";
import { bikeSchema, type BikeInput } from "@/lib/validation/master";

import { writeAudit } from "../../audit";
import { assertCan } from "../../auth/permissions";
import type { TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";
import { changedFields, PAGE_SIZE, paged, type ServiceCtx, withUniqueMessage } from "./common";

const DUPLICATE = "A bike with this name already exists.";

export async function listBikes(ctx: ServiceCtx, params: ListParams) {
  assertCan(ctx.user.role, "masterData.manage");
  const where = { ...statusWhere(params.status), ...searchWhere(params.q, ["name"]) };
  const [rows, total] = await Promise.all([
    ctx.db.bike.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { warehouse: { select: { name: true } }, driver: { select: { name: true } } },
    }),
    ctx.db.bike.count({ where }),
  ]);
  return paged(rows, total, params.page);
}

export async function getBike(ctx: ServiceCtx, id: string) {
  assertCan(ctx.user.role, "masterData.manage");
  const row = await ctx.db.bike.findUnique({ where: { id } });
  if (!row) throw new ServiceError("This bike was not found.");
  return row;
}

async function assertDriver(tx: TenantTx, data: BikeInput) {
  if (!data.driverId) return;
  const driver = await tx.staff.findUnique({ where: { id: data.driverId } });
  if (!driver || !driver.isActive || driver.role !== "DRIVER") {
    throw new ServiceError("Choose an active staff member with the Driver role.");
  }
}

export async function createBike(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "masterData.manage");
  const { requestId, ...data } = bikeSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    if (requestId) {
      const existing = await tx.bike.findUnique({
        where: { tenantId_requestId: { tenantId: ctx.user.tenantId, requestId } },
      });
      if (existing) return existing;
    }
    await assertDriver(tx, { requestId, ...data });
    const created = await withUniqueMessage(DUPLICATE, () =>
      tx.bike.create({ data: { tenantId: ctx.user.tenantId, requestId, ...data } }),
    );
    await writeAudit(tx, ctx.user, {
      action: "CREATE",
      entityType: "Bike",
      entityId: created.id,
      newValue: created,
      requestId,
    });
    return created;
  });
}

export async function updateBike(ctx: ServiceCtx, id: string, input: unknown) {
  assertCan(ctx.user.role, "masterData.manage");
  const parsed = bikeSchema.parse(input);
  const { requestId: _ignored, ...data } = parsed;
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.bike.findUnique({ where: { id } });
    if (!before) throw new ServiceError("This bike was not found.");
    await assertDriver(tx, parsed);
    const after = await withUniqueMessage(DUPLICATE, () => tx.bike.update({ where: { id }, data }));
    const diff = changedFields(before, after);
    if (diff.changed)
      await writeAudit(tx, ctx.user, {
        action: "UPDATE",
        entityType: "Bike",
        entityId: id,
        ...diff,
      });
    return after;
  });
}
