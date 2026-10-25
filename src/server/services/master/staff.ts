import "server-only";

import { filterParam, type ListParams, searchWhere, statusWhere } from "@/lib/list-params";
import { STAFF_ROLES, staffSchema } from "@/lib/validation/master";

import { writeAudit } from "../../audit";
import { assertCan } from "../../auth/permissions";
import type { TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";
import { changedFields, PAGE_SIZE, paged, type ServiceCtx } from "./common";

export async function listStaff(
  ctx: ServiceCtx,
  params: ListParams,
  filters: Record<string, unknown> = {},
) {
  assertCan(ctx.user.role, "masterData.manage");
  const role = filterParam(filters, "role");
  const where = {
    ...statusWhere(params.status),
    ...searchWhere(params.q, ["name", "phone"]),
    ...(role && (STAFF_ROLES as readonly string[]).includes(role)
      ? { role: role as (typeof STAFF_ROLES)[number] }
      : {}),
  };
  const [rows, total] = await Promise.all([
    ctx.db.staff.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { bikes: { select: { name: true } } },
    }),
    ctx.db.staff.count({ where }),
  ]);
  return paged(rows, total, params.page);
}

/**
 * Makes `bikeId` this staff member's only bike (null: none). A driver's bike is stored on the bike
 * (`Bike.driverId`), so the bike they leave is freed and the chosen bike's earlier driver replaced.
 */
async function assignBike(
  tx: TenantTx,
  ctx: ServiceCtx,
  staff: { id: string; name: string },
  bikeId: string | null,
) {
  if (bikeId) {
    const bike = await tx.bike.findUnique({ where: { id: bikeId } });
    if (!bike?.isActive) throw new ServiceError("Choose an active bike.");
  }
  const bikes = await tx.bike.findMany({
    where: { OR: [{ driverId: staff.id }, ...(bikeId ? [{ id: bikeId }] : [])] },
  });
  for (const bike of bikes) {
    const driverId = bike.id === bikeId ? staff.id : null;
    if (bike.driverId === driverId) continue;
    await tx.bike.update({ where: { id: bike.id }, data: { driverId } });
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "Bike",
      entityId: bike.id,
      oldValue: { driverId: bike.driverId },
      newValue: { driverId, via: `staff ${staff.name}` },
    });
  }
}

/** Active bikes with their driver, for the staff form. */
export function bikeOptions(ctx: ServiceCtx) {
  return ctx.db.bike.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, driverId: true, driver: { select: { name: true } } },
  });
}

/** Active drivers for the bike form. */
export function driverOptions(ctx: ServiceCtx) {
  return ctx.db.staff.findMany({
    where: { isActive: true, role: "DRIVER" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

export async function getStaff(ctx: ServiceCtx, id: string) {
  assertCan(ctx.user.role, "masterData.manage");
  const row = await ctx.db.staff.findUnique({ where: { id } });
  if (!row) throw new ServiceError("This staff member was not found.");
  return row;
}

export async function createStaff(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "masterData.manage");
  const { requestId, bikeId, ...data } = staffSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    if (requestId) {
      const existing = await tx.staff.findUnique({
        where: { tenantId_requestId: { tenantId: ctx.user.tenantId, requestId } },
      });
      if (existing) return existing;
    }
    const created = await tx.staff.create({
      data: { tenantId: ctx.user.tenantId, requestId, ...data },
    });
    if (data.role === "DRIVER" && bikeId) await assignBike(tx, ctx, created, bikeId);
    await writeAudit(tx, ctx.user, {
      action: "CREATE",
      entityType: "Staff",
      entityId: created.id,
      newValue: created,
      requestId,
    });
    return created;
  });
}

export async function updateStaff(ctx: ServiceCtx, id: string, input: unknown) {
  assertCan(ctx.user.role, "masterData.manage");
  const { requestId: _ignored, bikeId, ...data } = staffSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.staff.findUnique({ where: { id } });
    if (!before) throw new ServiceError("This staff member was not found.");
    const after = await tx.staff.update({ where: { id }, data });
    // Drivers ride the bike chosen here; anyone else rides none (their bike is freed).
    await assignBike(tx, ctx, after, data.role === "DRIVER" ? bikeId : null);
    const diff = changedFields(before, after);
    if (diff.changed)
      await writeAudit(tx, ctx.user, {
        action: "UPDATE",
        entityType: "Staff",
        entityId: id,
        ...diff,
      });
    return after;
  });
}
