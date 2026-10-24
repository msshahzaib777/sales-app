import "server-only";

import { prisma } from "./client";

// Tenant-scoped data layer (CLAUDE.md rule 1).
//
// `createTenantDb(tenantId)` returns a Prisma client that adds `tenantId` to every query:
// - reads, updates and deletes only ever match the tenant's own rows;
// - creates always get the tenant's id, and a different `tenantId` in the data is refused;
// - raw SQL is blocked (it would bypass the scoping).
// Nested creates inherit `tenantId` from their parent through the composite (tenantId, id) foreign
// keys, and those same keys stop any row from referencing another tenant's records.
//
// Prisma's generated types still require `tenantId` in most create inputs, so services pass
// `tenantId: ctx.user.tenantId`; the layer checks that it matches and refuses anything else.
//
// Application code gets a client through `requireTenantContext()` (src/server/auth/session.ts),
// which takes the tenant from the signed-in user's session. Only platform-level code (login,
// super admin) may use the raw client in ./client.ts.

/** Models whose rows belong to a tenant. A unit test checks this against schema.prisma. */
export const TENANT_MODELS = [
  "User",
  "AuditLog",
  "DocumentSequence",
  "Warehouse",
  "Company",
  "Product",
  "ProductPriceHistory",
  "ProductDiscountTier",
  "UnitConversion",
  "Area",
  "Customer",
  "Bike",
  "Staff",
  "PurchaseOrder",
  "PurchaseOrderLine",
  "GoodsReceipt",
  "GoodsReceiptLine",
  "CompanyBill",
  "CompanyPayment",
  "CompanyPaymentAllocation",
  "CompanyClaim",
  "Batch",
  "StockMovement",
  "StockAdjustment",
  "DeliveryTrip",
  "SalesOrder",
  "SalesOrderLine",
  "Bill",
  "BillRevision",
  "Cheque",
  "CustomerPayment",
  "CustomerOldBill",
  "PaymentAllocation",
  "LedgerEntry",
  "ExpenseCategory",
  "Expense",
] as const;

const tenantModels = new Set<string>(TENANT_MODELS);

/**
 * Append-only tables (CLAUDE.md rules 2 and 6): rows are only ever added; corrections are new
 * reversal rows. Database triggers enforce this too (phase1_schema migration); refusing here gives
 * a clear error before the query is sent.
 */
export const APPEND_ONLY_MODELS = [
  "LedgerEntry",
  "StockMovement",
  "BillRevision",
  "AuditLog",
  "ProductPriceHistory",
] as const;
const appendOnly = new Set<string>(APPEND_ONLY_MODELS);
const CHANGE_OPS = new Set([
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);

/** Reads/writes that take a unique `where` (extra filters are allowed alongside the unique key). */
const UNIQUE_WHERE_OPS = new Set(["findUnique", "findUniqueOrThrow", "update", "delete", "upsert"]);
/** Operations whose `where` is an ordinary filter. */
const FILTER_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "updateMany",
  "updateManyAndReturn",
  "deleteMany",
]);
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn"]);
/** The Tenant row itself: the tenant may read and update its own row, nothing else. */
const TENANT_ROW_OPS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "update",
]);

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

type Args = Record<string, unknown> & { where?: Record<string, unknown>; data?: unknown };

function withTenantData(model: string, data: unknown, tenantId: string): Record<string, unknown> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TenantScopeError(`${model}: expected an object for create data`);
  }
  const row = data as Record<string, unknown>;
  if ("tenant" in row) {
    throw new TenantScopeError(
      `${model}: do not set the tenant relation; the data layer sets tenantId`,
    );
  }
  if (row.tenantId !== undefined && row.tenantId !== tenantId) {
    throw new TenantScopeError(`${model}: cannot create a row for another tenant`);
  }
  return { ...row, tenantId };
}

function assertNoTenantChange(model: string, data: unknown) {
  if (data && typeof data === "object" && ("tenantId" in data || "tenant" in data)) {
    throw new TenantScopeError(`${model}: tenantId cannot be changed`);
  }
}

/**
 * Rewrites the arguments of one Prisma operation so it only touches `tenantId`'s rows.
 * Pure function, so the rules are unit-tested without a database.
 */
export function scopeArgs(
  model: string,
  operation: string,
  args: Args | undefined,
  tenantId: string,
): Args {
  const input: Args = { ...(args ?? {}) };

  if (model === "Tenant") {
    if (!TENANT_ROW_OPS.has(operation)) {
      throw new TenantScopeError(`Tenant.${operation} is not allowed from a tenant context`);
    }
    if (operation === "update") assertNoTenantChange(model, input.data);
    // Asking for another tenant's row finds nothing (the caller's filter is ANDed with ours).
    return { ...input, where: { id: tenantId, ...(input.where ? { AND: [input.where] } : {}) } };
  }

  if (!tenantModels.has(model)) {
    throw new TenantScopeError(
      `${model} is not registered as a tenant model in src/server/db/tenant.ts`,
    );
  }

  if (appendOnly.has(model) && CHANGE_OPS.has(operation)) {
    throw new TenantScopeError(
      `${model} is append-only: add a reversal entry instead of ${operation}`,
    );
  }

  if (UNIQUE_WHERE_OPS.has(operation)) {
    const where = input.where ?? {};
    if (where.tenantId !== undefined && where.tenantId !== tenantId) {
      throw new TenantScopeError(`${model}: cannot query another tenant`);
    }
    const scoped: Args = { ...input, where: { ...where, tenantId } };
    if (operation === "update") assertNoTenantChange(model, input.data);
    if (operation === "upsert") {
      scoped.create = withTenantData(model, input.create, tenantId);
      assertNoTenantChange(model, input.update);
    }
    return scoped;
  }

  if (FILTER_OPS.has(operation)) {
    if (operation === "updateMany" || operation === "updateManyAndReturn")
      assertNoTenantChange(model, input.data);
    return { ...input, where: input.where ? { AND: [input.where, { tenantId }] } : { tenantId } };
  }

  if (CREATE_OPS.has(operation)) {
    const data = Array.isArray(input.data)
      ? input.data.map((row) => withTenantData(model, row, tenantId))
      : withTenantData(model, input.data, tenantId);
    return { ...input, data };
  }

  throw new TenantScopeError(`${model}.${operation} is not supported by the tenant data layer`);
}

const RAW_METHODS = new Set([
  "$queryRaw",
  "$queryRawUnsafe",
  "$executeRaw",
  "$executeRawUnsafe",
  "$runCommandRaw",
]);

/** Blocks raw SQL and keeps interactive transactions on the scoped client. */
function guard<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (typeof prop === "string" && RAW_METHODS.has(prop)) {
        throw new TenantScopeError(`${prop} is not available on the tenant data layer`);
      }
      const value = Reflect.get(target, prop, receiver);
      if (prop === "$transaction" && typeof value === "function") {
        return (arg: unknown, options?: unknown) =>
          typeof arg === "function"
            ? value.call(target, (tx: object) => arg(guard(tx)), options)
            : value.call(target, arg, options);
      }
      return value;
    },
  });
}

function buildTenantDb(tenantId: string) {
  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args as Args, tenantId) as typeof args);
        },
      },
    },
  });
}

export type TenantDb = Omit<
  ReturnType<typeof buildTenantDb>,
  | "$queryRaw"
  | "$queryRawUnsafe"
  | "$executeRaw"
  | "$executeRawUnsafe"
  | "$extends"
  | "$connect"
  | "$disconnect"
>;

/** Client inside `db.$transaction(async (tx) => …)`. */
export type TenantTx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

/**
 * A Prisma client limited to one tenant. Trusted callers only: app code should use
 * `requireTenantContext()`, which takes the tenant from the session.
 */
export function createTenantDb(tenantId: string): TenantDb {
  if (!tenantId) throw new TenantScopeError("tenantId is required");
  return guard(buildTenantDb(tenantId));
}
