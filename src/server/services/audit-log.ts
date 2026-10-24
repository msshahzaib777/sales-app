import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { AuditAction } from "@/generated/prisma/enums";

import { assertCan } from "../auth/permissions";
import { PAGE_SIZE, paged, type ServiceCtx } from "./master/common";
import type { DateRange } from "./purchasing/filters";

// Audit log viewer (CLAUDE.md rule 6): who changed what and when, with old and new values. The
// log can hold purchase costs and amounts, so it is for the owner only (audit.view).

const ACTIONS: AuditAction[] = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "POST",
  "REVERSE",
  "APPROVE",
  "REJECT",
  "LOGIN",
];

export async function listAuditLog(
  ctx: ServiceCtx,
  f: {
    q?: string;
    entityType?: string;
    action?: string;
    userId?: string;
    page: number;
  } & DateRange,
) {
  assertCan(ctx.user.role, "audit.view");
  const end = f.to ? new Date(f.to.getTime() + 86_400_000) : undefined;
  const where: Prisma.AuditLogWhereInput = {
    ...(f.entityType ? { entityType: f.entityType } : {}),
    ...(f.action && ACTIONS.includes(f.action as AuditAction)
      ? { action: f.action as AuditAction }
      : {}),
    ...(f.userId ? { userId: f.userId } : {}),
    ...(f.q ? { entityId: f.q.trim() } : {}),
    ...(f.from || end
      ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(end ? { lt: end } : {}) } }
      : {}),
  };
  const [rows, total, types, users] = await Promise.all([
    ctx.db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { name: true } } },
    }),
    ctx.db.auditLog.count({ where }),
    ctx.db.auditLog.groupBy({ by: ["entityType"], orderBy: { entityType: "asc" } }),
    ctx.db.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return {
    ...paged(rows, total, f.page),
    entityTypes: types.map((t) => t.entityType),
    users,
    actions: ACTIONS,
  };
}
