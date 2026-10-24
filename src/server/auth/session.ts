import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { auth } from "@/auth";
import type { Role } from "@/generated/prisma/enums";

import { prisma } from "../db/client";
import { createTenantDb, type TenantDb } from "../db/tenant";
import { assertCan, type Permission } from "./permissions";

// Data access layer for the signed-in user. Every page and server action that touches tenant data
// goes through `requireTenantContext()`, which re-checks the session against the database.

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  tenantId: string | null;
  tenantName: string | null;
  mustChangePassword: boolean;
};

export type TenantUser = SessionUser & {
  tenantId: string;
  tenantName: string;
  role: Exclude<Role, "SUPER_ADMIN">;
};

export type TenantContext = { user: TenantUser; db: TenantDb };

/**
 * The signed-in user, or null, read fresh from the database so a deactivated user, a suspended
 * tenant, or a password reset ends the session immediately. Not memoised: use it in server actions
 * that change the user, because Next.js renders an action's redirect in the same request.
 */
export async function readSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { tenant: { select: { name: true, isActive: true } } },
  });
  if (!user || !user.isActive || user.sessionVersion !== session.sessionVersion) return null;
  if (user.tenantId && !user.tenant?.isActive) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    tenantId: user.tenantId,
    tenantName: user.tenant?.name ?? null,
    mustChangePassword: user.mustChangePassword,
  };
}

/** `readSessionUser`, memoised for the rest of the request (pages, layouts, components). */
export const getSessionUser = cache(readSessionUser);

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * A signed-in user of a tenant. Super admins go to the platform area; users with a temporary
 * password must change it first.
 */
export async function requireTenantUser(): Promise<TenantUser> {
  const user = await requireUser();
  if (user.mustChangePassword) redirect("/account/password");
  if (!user.tenantId || user.role === "SUPER_ADMIN") redirect("/admin");
  return user as TenantUser;
}

/**
 * The signed-in tenant user plus a data layer scoped to their tenant. Pass a permission to also
 * check it (throws ForbiddenError, which server actions turn into an error message).
 */
export async function requireTenantContext(permission?: Permission): Promise<TenantContext> {
  const user = await requireTenantUser();
  if (permission) assertCan(user.role, permission);
  return { user, db: createTenantDb(user.tenantId) };
}
