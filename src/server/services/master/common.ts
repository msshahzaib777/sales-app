import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { Role } from "@/generated/prisma/enums";
import { recordIdSchema } from "@/lib/validation/master";

import { writeAudit } from "../../audit";
import { assertCan } from "../../auth/permissions";
import type { TenantDb, TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";

export type ServiceCtx = { db: TenantDb; user: { id: string; role: Role; tenantId: string } };

export const PAGE_SIZE = 50;

export type Paged<T> = { rows: T[]; total: number; page: number; pageCount: number };

export function paged<T>(rows: T[], total: number, page: number): Paged<T> {
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isReferencedViolation(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2003: foreign key; P2014/P2017: required relation.
    return ["P2003", "P2014", "P2017"].includes(error.code);
  }
  // Append-only triggers raise restrict_violation, surfaced as an unknown request error.
  return (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    /append-only|restrict/i.test(error.message)
  );
}

/** Runs a create; a duplicate on a unique column becomes a readable error. */
export async function withUniqueMessage<T>(message: string, body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error) {
    if (isUniqueViolation(error)) throw new ServiceError(message);
    throw error;
  }
}

// ───────────── Deactivate / reactivate / delete for any master record ─────────────

type MasterDelegate = {
  findUnique(args: {
    where: { id: string };
  }): Promise<(Record<string, unknown> & { id: string; isActive: boolean }) | null>;
  update(args: {
    where: { id: string };
    data: { isActive: boolean };
  }): Promise<Record<string, unknown>>;
  delete(args: { where: { id: string } }): Promise<unknown>;
};

const MASTER_MODELS = {
  Warehouse: (tx: TenantTx) => tx.warehouse,
  Area: (tx: TenantTx) => tx.area,
  Company: (tx: TenantTx) => tx.company,
  Product: (tx: TenantTx) => tx.product,
  Customer: (tx: TenantTx) => tx.customer,
  Bike: (tx: TenantTx) => tx.bike,
  Staff: (tx: TenantTx) => tx.staff,
} as const;

export type MasterEntity = keyof typeof MASTER_MODELS;
export const MASTER_ENTITIES = Object.keys(MASTER_MODELS) as MasterEntity[];

const LABELS: Record<MasterEntity, string> = {
  Warehouse: "warehouse",
  Area: "area",
  Company: "company",
  Product: "product",
  Customer: "customer",
  Bike: "bike",
  Staff: "staff member",
};

function delegate(tx: TenantTx, entity: MasterEntity): MasterDelegate {
  // Prisma delegates are generic; this narrow view is all the shared helpers need.
  return MASTER_MODELS[entity](tx) as unknown as MasterDelegate;
}

export async function setRecordActive(
  ctx: ServiceCtx,
  entity: MasterEntity,
  input: unknown,
  isActive: boolean,
) {
  assertCan(ctx.user.role, "masterData.manage");
  const { id } = recordIdSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const model = delegate(tx, entity);
    const before = await model.findUnique({ where: { id } });
    if (!before) throw new ServiceError(`This ${LABELS[entity]} was not found.`);
    if (before.isActive === isActive) return before;
    const after = await model.update({ where: { id }, data: { isActive } });
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: entity,
      entityId: id,
      oldValue: { isActive: before.isActive },
      newValue: { isActive },
    });
    return after;
  });
}

/**
 * Deletes a record that has never been used. Anything referenced by other rows (transactions,
 * ledger entries, price history, …) is refused by the database; the user is told to deactivate it.
 */
export async function deleteRecord(ctx: ServiceCtx, entity: MasterEntity, input: unknown) {
  assertCan(ctx.user.role, "masterData.manage");
  const { id } = recordIdSchema.parse(input);
  try {
    await ctx.db.$transaction(async (tx) => {
      const model = delegate(tx, entity);
      const before = await model.findUnique({ where: { id } });
      if (!before) throw new ServiceError(`This ${LABELS[entity]} was not found.`);
      await model.delete({ where: { id } });
      await writeAudit(tx, ctx.user, {
        action: "DELETE",
        entityType: entity,
        entityId: id,
        oldValue: before,
      });
    });
  } catch (error) {
    if (isReferencedViolation(error)) {
      throw new ServiceError(
        `This ${LABELS[entity]} is already used in other records, so it cannot be deleted. Deactivate it instead.`,
      );
    }
    throw error;
  }
}

/** Only fields that changed, for compact audit rows. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>) {
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (key === "updatedAt" || key === "createdAt") continue;
    const a = JSON.stringify(before[key] ?? null);
    const b = JSON.stringify(after[key] ?? null);
    if (a !== b) {
      oldValue[key] = before[key] ?? null;
      newValue[key] = after[key] ?? null;
    }
  }
  return { oldValue, newValue, changed: Object.keys(newValue).length > 0 };
}
