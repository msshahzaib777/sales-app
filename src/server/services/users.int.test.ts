import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { authenticate } from "../auth/credentials";
import { hashPassword } from "../auth/password";
import { ForbiddenError } from "../auth/permissions";
import { prisma } from "../db/client";
import { createTenantDb } from "../db/tenant";
import { ServiceError } from "./errors";
import { changeUserRole, inviteUser, listUsers, resetUserPassword, setUserActive } from "./users";

async function makeTenant() {
  const suffix = randomUUID().slice(0, 8);
  const tenant = await prisma.tenant.create({ data: { name: `T ${suffix}`, slug: `t-${suffix}` } });
  const owner = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `owner-${suffix}@test.local`,
      name: "Owner",
      role: "OWNER",
      passwordHash: await hashPassword("Owner1234"),
      mustChangePassword: false,
    },
  });
  const db = createTenantDb(tenant.id);
  return { tenant, owner, db, ownerCtx: { db, user: { id: owner.id, role: "OWNER" as const } } };
}

const email = () => `user-${randomUUID().slice(0, 8)}@test.local`;

let t: Awaited<ReturnType<typeof makeTenant>>;
beforeEach(async () => {
  t = await makeTenant();
});

describe("inviteUser", () => {
  it("creates a user with a temporary password and an audit row", async () => {
    const { user, temporaryPassword } = await inviteUser(t.ownerCtx, {
      name: "Kamran",
      email: email(),
      role: "STAFF",
    });
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.tenantId).toBe(t.tenant.id);
    expect(stored.mustChangePassword).toBe(true);
    expect(stored.passwordHash).not.toContain(temporaryPassword);
    expect(await authenticate(stored.email, temporaryPassword)).toMatchObject({ id: user.id });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: user.id, action: "CREATE" },
    });
    expect(audit).toMatchObject({ tenantId: t.tenant.id, userId: t.owner.id, entityType: "User" });
    expect(JSON.stringify(audit.newValue)).not.toMatch(/password/i);
  });

  it("refuses a duplicate email with a readable message", async () => {
    const address = email();
    await inviteUser(t.ownerCtx, { name: "One", email: address, role: "STAFF" });
    await expect(
      inviteUser(t.ownerCtx, { name: "Two", email: address.toUpperCase(), role: "STAFF" }),
    ).rejects.toThrow(ServiceError);
  });

  it("is owner-only on the server", async () => {
    for (const role of ["ACCOUNTANT", "STAFF"] as const) {
      const ctx = { db: t.db, user: { id: t.owner.id, role } };
      await expect(inviteUser(ctx, { name: "X", email: email(), role: "STAFF" })).rejects.toThrow(
        ForbiddenError,
      );
      await expect(listUsers(ctx)).rejects.toThrow(ForbiddenError);
    }
  });
});

describe("managing users", () => {
  it("changes roles and audits old and new values", async () => {
    const { user } = await inviteUser(t.ownerCtx, {
      name: "Ayesha",
      email: email(),
      role: "STAFF",
    });
    const updated = await changeUserRole(t.ownerCtx, { userId: user.id, role: "ACCOUNTANT" });
    expect(updated.role).toBe("ACCOUNTANT");
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: user.id, action: "UPDATE" },
    });
    expect(audit.oldValue).toMatchObject({ role: "STAFF" });
    expect(audit.newValue).toMatchObject({ role: "ACCOUNTANT" });
  });

  it("deactivating ends sessions and blocks sign-in", async () => {
    const { user, temporaryPassword } = await inviteUser(t.ownerCtx, {
      name: "Driver",
      email: email(),
      role: "STAFF",
    });
    await setUserActive(t.ownerCtx, { userId: user.id }, false);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.isActive).toBe(false);
    expect(stored.sessionVersion).toBe(1);
    expect(await authenticate(stored.email, temporaryPassword)).toBeNull();

    await setUserActive(t.ownerCtx, { userId: user.id }, true);
    expect(await authenticate(stored.email, temporaryPassword)).not.toBeNull();
  });

  it("password reset replaces the password and ends sessions", async () => {
    const { user, temporaryPassword: first } = await inviteUser(t.ownerCtx, {
      name: "Sana",
      email: email(),
      role: "STAFF",
    });
    const { temporaryPassword: second } = await resetUserPassword(t.ownerCtx, { userId: user.id });
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.sessionVersion).toBe(1);
    expect(await authenticate(stored.email, first)).toBeNull();
    expect(await authenticate(stored.email, second)).not.toBeNull();
  });

  it("never leaves the business without an active owner, and owners cannot lock themselves out", async () => {
    await expect(changeUserRole(t.ownerCtx, { userId: t.owner.id, role: "STAFF" })).rejects.toThrow(
      ServiceError,
    );
    await expect(setUserActive(t.ownerCtx, { userId: t.owner.id }, false)).rejects.toThrow(
      ServiceError,
    );

    // A second owner can be demoted while the first remains.
    const { user: second } = await inviteUser(t.ownerCtx, {
      name: "Partner",
      email: email(),
      role: "OWNER",
    });
    await changeUserRole(t.ownerCtx, { userId: second.id, role: "ACCOUNTANT" });
    // The second owner (now accountant) acting as owner cannot remove the only owner.
    const ctx2 = { db: t.db, user: { id: second.id, role: "OWNER" as const } };
    await expect(setUserActive(ctx2, { userId: t.owner.id }, false)).rejects.toThrow(
      "The business needs at least one active owner.",
    );
  });
});

describe("tenant isolation in user management", () => {
  it("an owner can neither see nor change another tenant's users", async () => {
    const other = await makeTenant();
    const { user: theirs } = await inviteUser(other.ownerCtx, {
      name: "Theirs",
      email: email(),
      role: "STAFF",
    });

    const visible = await listUsers(t.ownerCtx);
    expect(visible.map((u) => u.id)).not.toContain(theirs.id);
    expect(visible.map((u) => u.id)).not.toContain(other.owner.id);

    for (const attempt of [
      () => changeUserRole(t.ownerCtx, { userId: theirs.id, role: "OWNER" }),
      () => setUserActive(t.ownerCtx, { userId: theirs.id }, false),
      () => resetUserPassword(t.ownerCtx, { userId: theirs.id }),
      () => setUserActive(t.ownerCtx, { userId: other.owner.id }, false),
    ]) {
      await expect(attempt()).rejects.toThrow("User not found.");
    }
    const untouched = await prisma.user.findUniqueOrThrow({ where: { id: theirs.id } });
    expect(untouched).toMatchObject({ role: "STAFF", isActive: true, sessionVersion: 0 });
  });
});

describe("authenticate", () => {
  it("accepts the right password only, case-insensitively by email", async () => {
    expect(await authenticate(t.owner.email.toUpperCase(), "Owner1234")).toMatchObject({
      id: t.owner.id,
    });
    expect(await authenticate(t.owner.email, "wrong-password1")).toBeNull();
    expect(await authenticate("nobody@test.local", "Owner1234")).toBeNull();
    expect(await authenticate("", "")).toBeNull();
  });

  it("refuses users of a suspended tenant", async () => {
    await prisma.tenant.update({ where: { id: t.tenant.id }, data: { isActive: false } });
    expect(await authenticate(t.owner.email, "Owner1234")).toBeNull();
  });

  it("records sign-ins in the audit log", async () => {
    await authenticate(t.owner.email, "Owner1234");
    const row = await prisma.auditLog.findFirst({
      where: { entityId: t.owner.id, action: "LOGIN" },
    });
    expect(row?.tenantId).toBe(t.tenant.id);
  });
});
