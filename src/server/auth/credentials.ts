import "server-only";

import { loginSchema } from "@/lib/validation/auth";

import { prisma } from "../db/client";
import { writeAudit } from "../audit";
import { hashPassword, verifyPassword } from "./password";

// Platform-level login check (uses the raw client: there is no tenant until the user is known).

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  sessionVersion: number;
};

let dummyHash: Promise<string> | undefined;

/**
 * Returns the user for a correct email + password, or null. Inactive users and users of a
 * suspended tenant cannot sign in. Unknown emails still pay for a hash check, so response time
 * does not reveal which emails exist.
 */
export async function authenticate(
  rawEmail: unknown,
  rawPassword: unknown,
): Promise<AuthenticatedUser | null> {
  const parsed = loginSchema.safeParse({ email: rawEmail, password: rawPassword });
  if (!parsed.success) return null;
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    include: { tenant: { select: { isActive: true } } },
  });
  if (!user) {
    dummyHash ??= hashPassword("timing-equaliser-not-a-real-password");
    await verifyPassword(password, await dummyHash);
    return null;
  }

  const passwordOk = await verifyPassword(password, user.passwordHash);
  if (!passwordOk || !user.isActive || (user.tenantId && !user.tenant?.isActive)) return null;

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await writeAudit(tx, user, {
      tenantId: user.tenantId,
      action: "LOGIN",
      entityType: "User",
      entityId: user.id,
    });
  });

  return { id: user.id, name: user.name, email: user.email, sessionVersion: user.sessionVersion };
}
