import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { changeRoleSchema, inviteUserSchema, userIdSchema } from "@/lib/validation/users";

import { writeAudit } from "../audit";
import { generateTemporaryPassword, hashPassword } from "../auth/password";
import { assertCan } from "../auth/permissions";
import type { TenantContext } from "../auth/session";
import type { TenantTx } from "../db/tenant";
import { ServiceError } from "./errors";

// Tenant user management (owner only). There is no email sending yet, so "inviting" creates the
// login with a one-time temporary password that the owner passes on (e.g. on WhatsApp). The user
// must choose their own password after first sign-in.

type Ctx = Pick<TenantContext, "db"> & { user: Pick<TenantContext["user"], "id" | "role"> };

/** What the users page shows. Never includes the password hash. */
const userListSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

/** Fields kept in the audit log for user changes. */
const auditSelect = { id: true, name: true, email: true, role: true, isActive: true } as const;

export type UserListItem = Prisma.UserGetPayload<{ select: typeof userListSelect }>;

export async function listUsers(ctx: Ctx): Promise<UserListItem[]> {
  assertCan(ctx.user.role, "users.manage");
  return ctx.db.user.findMany({
    select: userListSelect,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

export async function inviteUser(ctx: Ctx, input: unknown) {
  assertCan(ctx.user.role, "users.manage");
  const data = inviteUserSchema.parse(input);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  try {
    const user = await ctx.db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { ...data, passwordHash, mustChangePassword: true },
        select: auditSelect,
      });
      await writeAudit(tx, ctx.user, {
        action: "CREATE",
        entityType: "User",
        entityId: created.id,
        newValue: created,
      });
      return created;
    });
    return { user, temporaryPassword };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ServiceError("This email is already in use. Use a different email address.");
    }
    throw error;
  }
}

/** Fails if the change would leave the tenant without an active owner. */
async function assertAnotherActiveOwner(tx: TenantTx, excludingUserId: string) {
  const owners = await tx.user.count({
    where: { role: "OWNER", isActive: true, id: { not: excludingUserId } },
  });
  if (owners === 0) throw new ServiceError("The business needs at least one active owner.");
}

async function getTarget(tx: TenantTx, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: auditSelect });
  // A user of another tenant is simply not found through the tenant data layer.
  if (!user) throw new ServiceError("User not found.");
  return user;
}

// Owner-count checks must not race (two owners demoting each other at once), so these run
// serializable; Postgres then aborts one of two conflicting transactions.
const serializable = { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };

export async function changeUserRole(ctx: Ctx, input: unknown) {
  assertCan(ctx.user.role, "users.manage");
  const { userId, role } = changeRoleSchema.parse(input);
  if (userId === ctx.user.id) throw new ServiceError("You cannot change your own role.");

  return ctx.db.$transaction(async (tx) => {
    const before = await getTarget(tx, userId);
    if (before.role === role) return before;
    if (before.role === "OWNER") await assertAnotherActiveOwner(tx, userId);
    const after = await tx.user.update({
      where: { id: userId },
      data: { role },
      select: auditSelect,
    });
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "User",
      entityId: userId,
      oldValue: before,
      newValue: after,
    });
    return after;
  }, serializable);
}

export async function setUserActive(ctx: Ctx, input: unknown, isActive: boolean) {
  assertCan(ctx.user.role, "users.manage");
  const { userId } = userIdSchema.parse(input);
  if (userId === ctx.user.id) throw new ServiceError("You cannot deactivate yourself.");

  return ctx.db.$transaction(async (tx) => {
    const before = await getTarget(tx, userId);
    if (before.isActive === isActive) return before;
    if (!isActive && before.role === "OWNER") await assertAnotherActiveOwner(tx, userId);
    const after = await tx.user.update({
      where: { id: userId },
      // Deactivating also ends the user's open sessions.
      data: isActive ? { isActive } : { isActive, sessionVersion: { increment: 1 } },
      select: auditSelect,
    });
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "User",
      entityId: userId,
      oldValue: before,
      newValue: after,
    });
    return after;
  }, serializable);
}

/** Issues a new temporary password and signs the user out everywhere. */
export async function resetUserPassword(ctx: Ctx, input: unknown) {
  assertCan(ctx.user.role, "users.manage");
  const { userId } = userIdSchema.parse(input);
  if (userId === ctx.user.id)
    throw new ServiceError("Use “Change password” to change your own password.");
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const user = await ctx.db.$transaction(async (tx) => {
    const target = await getTarget(tx, userId);
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true, sessionVersion: { increment: 1 } },
    });
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "User",
      entityId: userId,
      newValue: { event: "TEMPORARY_PASSWORD_ISSUED" },
    });
    return target;
  });
  return { user, temporaryPassword };
}
