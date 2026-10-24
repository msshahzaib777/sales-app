import "server-only";

import { changePasswordSchema } from "@/lib/validation/auth";

import { writeAudit } from "../audit";
import { prisma } from "../db/client";
import { ServiceError } from "../services/errors";
import { hashPassword, verifyPassword } from "./password";

// The signed-in user's own account. Uses the raw client because super admins have no tenant;
// every query is limited to the user's own row.

/** Changes the user's own password and ends all their sessions. */
export async function changeOwnPassword(
  userId: string,
  input: unknown,
): Promise<{ email: string }> {
  const { currentPassword, newPassword } = changePasswordSchema.parse(input);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new ServiceError("Your current password is not correct.");
  }
  const passwordHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false, sessionVersion: { increment: 1 } },
    });
    await writeAudit(tx, user, {
      tenantId: user.tenantId,
      action: "UPDATE",
      entityType: "User",
      entityId: userId,
      newValue: { event: "PASSWORD_CHANGED" },
    });
  });
  return { email: user.email };
}
