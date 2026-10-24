"use server";

import { refresh } from "next/cache";

import type { ActionState } from "@/lib/action-state";
import { runAction } from "@/server/actions";
import { requireTenantContext } from "@/server/auth/session";
import {
  changeUserRole,
  inviteUser,
  resetUserPassword,
  setUserActive,
} from "@/server/services/users";

// Thin wrappers: each re-checks the session and permission on the server, then calls the service
// (which validates input, checks the permission again and writes the audit log).

export type TemporaryPassword = { email: string; temporaryPassword: string };

export async function inviteUserAction(
  _prev: ActionState<TemporaryPassword>,
  formData: FormData,
): Promise<ActionState<TemporaryPassword>> {
  return runAction(async () => {
    const ctx = await requireTenantContext("users.manage");
    const { user, temporaryPassword } = await inviteUser(ctx, Object.fromEntries(formData));
    refresh();
    return {
      message: `${user.name} can now sign in.`,
      data: { email: user.email, temporaryPassword },
    };
  }, formData);
}

export async function changeRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction<undefined>(async () => {
    const ctx = await requireTenantContext("users.manage");
    await changeUserRole(ctx, Object.fromEntries(formData));
    refresh();
    return { message: "Role updated." };
  });
}

export async function setActiveAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction<undefined>(async () => {
    const ctx = await requireTenantContext("users.manage");
    const active = formData.get("active") === "true";
    await setUserActive(ctx, { userId: formData.get("userId") }, active);
    refresh();
    return { message: active ? "User reactivated." : "User deactivated and signed out." };
  });
}

export async function resetPasswordAction(
  _prev: ActionState<TemporaryPassword>,
  formData: FormData,
): Promise<ActionState<TemporaryPassword>> {
  return runAction(async () => {
    const ctx = await requireTenantContext("users.manage");
    const { user, temporaryPassword } = await resetUserPassword(ctx, {
      userId: formData.get("userId"),
    });
    refresh();
    return {
      message: `New temporary password for ${user.name}.`,
      data: { email: user.email, temporaryPassword },
    };
  });
}
