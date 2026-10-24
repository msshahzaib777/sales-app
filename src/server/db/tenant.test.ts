import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { scopeArgs, TENANT_MODELS, TenantScopeError } from "./tenant";

const A = "tenant-a";

describe("TENANT_MODELS", () => {
  it("lists exactly the models in schema.prisma that have a tenantId column", () => {
    const schema = readFileSync(path.join(__dirname, "../../../prisma/schema.prisma"), "utf8");
    const withTenantId = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => /^\s+tenantId\s/m.test(body!))
      .map(([, name]) => name);
    expect([...TENANT_MODELS].sort()).toEqual(withTenantId.sort());
  });
});

describe("scopeArgs", () => {
  it("adds tenantId to filters without dropping the caller's filter", () => {
    expect(scopeArgs("Customer", "findMany", { where: { name: "Ali" } }, A)).toEqual({
      where: { AND: [{ name: "Ali" }, { tenantId: A }] },
    });
    expect(scopeArgs("Customer", "count", undefined, A)).toEqual({ where: { tenantId: A } });
  });

  it("cannot be widened by a caller asking for another tenant in a filter", () => {
    // The caller's condition is ANDed with ours, so it can only narrow the result.
    const args = scopeArgs("Product", "findMany", { where: { tenantId: "tenant-b" } }, A);
    expect(args.where).toEqual({ AND: [{ tenantId: "tenant-b" }, { tenantId: A }] });
  });

  it("adds tenantId next to unique keys", () => {
    expect(scopeArgs("Product", "findUnique", { where: { id: "p1" } }, A)).toEqual({
      where: { id: "p1", tenantId: A },
    });
    expect(scopeArgs("Product", "delete", { where: { id: "p1" } }, A).where).toEqual({
      id: "p1",
      tenantId: A,
    });
  });

  it("refuses unique lookups that name another tenant", () => {
    expect(() =>
      scopeArgs("Product", "findUnique", { where: { id: "p1", tenantId: "b" } }, A),
    ).toThrow(TenantScopeError);
  });

  it("sets tenantId on creates and refuses another tenant's id", () => {
    expect(scopeArgs("Warehouse", "create", { data: { name: "W" } }, A).data).toEqual({
      name: "W",
      tenantId: A,
    });
    expect(
      scopeArgs("Warehouse", "createMany", { data: [{ name: "1" }, { name: "2" }] }, A).data,
    ).toEqual([
      { name: "1", tenantId: A },
      { name: "2", tenantId: A },
    ]);
    expect(() =>
      scopeArgs("Warehouse", "create", { data: { name: "W", tenantId: "b" } }, A),
    ).toThrow(TenantScopeError);
    expect(() =>
      scopeArgs(
        "Warehouse",
        "create",
        { data: { name: "W", tenant: { connect: { id: "b" } } } },
        A,
      ),
    ).toThrow(TenantScopeError);
  });

  it("never lets an update move a row to another tenant", () => {
    expect(() =>
      scopeArgs("Customer", "update", { where: { id: "c" }, data: { tenantId: "b" } }, A),
    ).toThrow(TenantScopeError);
    expect(() => scopeArgs("Customer", "updateMany", { data: { tenantId: "b" } }, A)).toThrow(
      TenantScopeError,
    );
  });

  it("scopes upserts on both the lookup and the create", () => {
    const args = scopeArgs(
      "DocumentSequence",
      "upsert",
      {
        where: { tenantId_key: { tenantId: A, key: "BILL" } },
        create: { key: "BILL" },
        update: {},
      },
      A,
    );
    expect(args.where).toMatchObject({ tenantId: A });
    expect(args.create).toEqual({ key: "BILL", tenantId: A });
  });

  it("only lets a tenant read or update its own Tenant row", () => {
    expect(scopeArgs("Tenant", "findUnique", { where: { id: "other" } }, A).where).toEqual({
      id: A,
      AND: [{ id: "other" }],
    });
    expect(() => scopeArgs("Tenant", "create", { data: {} }, A)).toThrow(TenantScopeError);
    expect(() => scopeArgs("Tenant", "findMany", {}, A)).toThrow(TenantScopeError);
  });

  it("rejects unknown models and operations", () => {
    expect(() => scopeArgs("Mystery", "findMany", {}, A)).toThrow(TenantScopeError);
    expect(() => scopeArgs("Customer", "somethingNew", {}, A)).toThrow(TenantScopeError);
  });
});

describe("append-only journals", () => {
  it("only lets journal, revision, price-history and audit rows be added and read", () => {
    for (const model of [
      "LedgerEntry",
      "StockMovement",
      "BillRevision",
      "AuditLog",
      "ProductPriceHistory",
    ]) {
      for (const op of ["update", "updateMany", "upsert", "delete", "deleteMany"]) {
        expect(() => scopeArgs(model, op, { where: { id: "x" }, data: {} }, A)).toThrow(
          /append-only/,
        );
      }
      expect(() => scopeArgs(model, "create", { data: {} }, A)).not.toThrow();
      expect(() => scopeArgs(model, "findMany", {}, A)).not.toThrow();
    }
  });
});
