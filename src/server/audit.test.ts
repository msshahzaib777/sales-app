import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";

import { toAuditJson, writeAudit } from "./audit";

describe("toAuditJson", () => {
  it("drops secrets at any depth", () => {
    expect(
      toAuditJson({
        email: "a@b.c",
        passwordHash: "scrypt$…",
        nested: { resetToken: "x", name: "n" },
      }),
    ).toEqual({ email: "a@b.c", nested: { name: "n" } });
  });

  it("stores decimals and dates as strings", () => {
    expect(
      toAuditJson({
        amount: new Prisma.Decimal("1250.50"),
        at: new Date("2026-10-24T00:00:00.000Z"),
      }),
    ).toEqual({ amount: "1250.5", at: "2026-10-24T00:00:00.000Z" });
  });

  it("returns undefined for missing values", () => {
    expect(toAuditJson(undefined)).toBeUndefined();
    expect(toAuditJson(null)).toBeUndefined();
  });
});

describe("writeAudit", () => {
  it("writes one row with the actor and sanitised values", async () => {
    const rows: unknown[] = [];
    const db = { auditLog: { create: async (args: { data: unknown }) => rows.push(args.data) } };
    await writeAudit(
      db,
      { id: "u1" },
      {
        action: "UPDATE",
        entityType: "User",
        entityId: "u2",
        oldValue: { role: "STAFF", passwordHash: "x" },
        newValue: { role: "ACCOUNTANT" },
      },
    );
    expect(rows).toEqual([
      {
        userId: "u1",
        action: "UPDATE",
        entityType: "User",
        entityId: "u2",
        oldValue: { role: "STAFF" },
        newValue: { role: "ACCOUNTANT" },
        requestId: undefined,
      },
    ]);
  });
});
