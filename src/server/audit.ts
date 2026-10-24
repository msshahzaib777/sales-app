import type { AuditAction } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

// Audit log helper (CLAUDE.md rule 6). Call it inside the same transaction as the change, so the
// change and its audit row are saved together or not at all:
//
//   await db.$transaction(async (tx) => {
//     const before = await tx.customer.findUniqueOrThrow({ where: { id } });
//     const after = await tx.customer.update({ where: { id }, data });
//     await writeAudit(tx, user, { action: "UPDATE", entityType: "Customer", entityId: id, oldValue: before, newValue: after });
//   });
//
// AuditLog is append-only in the database.

/** Anything with `auditLog.create`: the tenant client, a transaction client, or the raw client. */
type AuditWriter = {
  auditLog: { create(args: { data: Prisma.AuditLogUncheckedCreateInput }): Promise<unknown> };
};

export type AuditActor = { id: string };

export type AuditEntry = {
  action: AuditAction;
  /** Model name, e.g. "User", "SalesOrder". */
  entityType: string;
  entityId: string;
  oldValue?: unknown;
  newValue?: unknown;
  requestId?: string;
  /** Only for platform-level writes through the raw client; the tenant client sets it itself. */
  tenantId?: string | null;
};

const SECRET_KEY = /password|secret|token|hash/i;

/**
 * Makes a value safe and compact for the audit log: drops secrets (password hashes, tokens),
 * turns Decimals and Dates into strings, and drops undefined.
 */
export function toAuditJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  const json = JSON.stringify(value, (key, v: unknown) =>
    key && SECRET_KEY.test(key) ? undefined : v,
  );
  return json === undefined ? undefined : (JSON.parse(json) as Prisma.InputJsonValue);
}

export async function writeAudit(
  db: AuditWriter,
  actor: AuditActor | null,
  entry: AuditEntry,
): Promise<void> {
  await db.auditLog.create({
    data: {
      ...(entry.tenantId !== undefined ? { tenantId: entry.tenantId } : {}),
      userId: actor?.id ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      oldValue: toAuditJson(entry.oldValue),
      newValue: toAuditJson(entry.newValue),
      requestId: entry.requestId,
    },
  });
}
