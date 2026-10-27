import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { businessToday } from "@/lib/dates";
import {
  filterParam,
  icontains,
  type ListParams,
  matchEveryWord,
  phoneContains,
  statusWhere,
} from "@/lib/list-params";
import { CUSTOMER_TYPES, type CustomerInput, customerSchema } from "@/lib/validation/master";

import { writeAudit } from "../../audit";
import { assertCan } from "../../auth/permissions";
import type { TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";
import { changedFields, PAGE_SIZE, paged, type ServiceCtx } from "./common";
import {
  customerBalances,
  getCustomerOpeningBalances,
  setOpeningBalance,
} from "./opening-balances";

/** Customer list with each customer's current pending balance (everyone can see it: order entry). */
export async function listCustomers(
  ctx: ServiceCtx,
  params: ListParams,
  filters: Record<string, unknown> = {},
) {
  const areaId = filterParam(filters, "areaId");
  const type = filterParam(filters, "type");
  const where = {
    ...statusWhere(params.status),
    ...matchEveryWord(params.q, (w): Prisma.CustomerWhereInput[] => [
      ...["name", "shopName", "address"].map((field) => ({ [field]: icontains(w) })),
      { phone: phoneContains(w) },
      { whatsapp: phoneContains(w) },
      { area: { name: icontains(w) } },
    ]),
    ...(areaId ? { areaId } : {}),
    ...(type && (CUSTOMER_TYPES as readonly string[]).includes(type)
      ? { type: type as (typeof CUSTOMER_TYPES)[number] }
      : {}),
  };
  const [rows, total] = await Promise.all([
    ctx.db.customer.findMany({
      where,
      orderBy: [{ area: { sortOrder: "asc" } }, { routeSequence: "asc" }, { name: "asc" }],
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { area: { select: { name: true } } },
    }),
    ctx.db.customer.count({ where }),
  ]);
  const balances = await customerBalances(
    ctx.db,
    rows.map((r) => r.id),
  );
  return paged(
    rows.map((row) => ({ ...row, balance: balances.get(row.id)?.toFixed(2) ?? "0.00" })),
    total,
    params.page,
  );
}

export async function getCustomer(ctx: ServiceCtx, id: string) {
  assertCan(ctx.user.role, "masterData.manage");
  const row = await ctx.db.customer.findUnique({
    where: { id },
    include: { area: { select: { name: true, warehouse: { select: { name: true } } } } },
  });
  if (!row) throw new ServiceError("This customer was not found.");
  const openings = await getCustomerOpeningBalances(ctx.db, id);
  return {
    ...row,
    openingBalances: Object.fromEntries(
      Object.entries(openings).map(([companyId, v]) => [companyId, v.toFixed(2)]),
    ),
  };
}

async function assertArea(tx: TenantTx, areaId: string | null) {
  if (!areaId) return;
  const area = await tx.area.findUnique({ where: { id: areaId } });
  if (!area || !area.isActive) throw new ServiceError("Choose an active area.");
}

/** Posts opening-balance changes per company; returns { companyId: { from, to } } for the audit log. */
async function applyOpeningBalances(
  tx: TenantTx,
  ctx: ServiceCtx,
  customerId: string,
  balances: Record<string, string>,
) {
  const changes: Record<string, { from: string; to: string }> = {};
  const companyIds = Object.keys(balances);
  if (companyIds.length === 0) return changes;
  const known = await tx.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true },
  });
  if (known.length !== companyIds.length)
    throw new ServiceError("An opening balance refers to an unknown company.");
  const today = businessToday();
  for (const companyId of companyIds) {
    const change = await setOpeningBalance(
      tx,
      ctx,
      { kind: "CUSTOMER", customerId, companyId },
      balances[companyId]!,
      today,
    );
    if (change) changes[companyId] = change;
  }
  return changes;
}

/** Creates a customer inside the caller's transaction (also used by the import). */
export async function createCustomerTx(
  tx: TenantTx,
  ctx: ServiceCtx,
  parsed: CustomerInput,
  requestId?: string,
) {
  const { requestId: _r, openingBalances, ...data } = parsed;
  if (requestId) {
    const existing = await tx.customer.findUnique({
      where: { tenantId_requestId: { tenantId: ctx.user.tenantId, requestId } },
    });
    if (existing) return existing;
  }
  await assertArea(tx, data.areaId);
  const created = await tx.customer.create({
    data: { tenantId: ctx.user.tenantId, requestId, ...data },
  });
  const openings = await applyOpeningBalances(tx, ctx, created.id, openingBalances);
  await writeAudit(tx, ctx.user, {
    action: "CREATE",
    entityType: "Customer",
    entityId: created.id,
    newValue: { ...created, openingBalances: openings },
    requestId,
  });
  return created;
}

export async function createCustomer(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "masterData.manage");
  const parsed = customerSchema.parse(input);
  return ctx.db.$transaction((tx) => createCustomerTx(tx, ctx, parsed, parsed.requestId));
}

export async function updateCustomer(ctx: ServiceCtx, id: string, input: unknown) {
  assertCan(ctx.user.role, "masterData.manage");
  const { requestId: _ignored, openingBalances, ...data } = customerSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.customer.findUnique({ where: { id } });
    if (!before) throw new ServiceError("This customer was not found.");
    if (data.areaId !== before.areaId) await assertArea(tx, data.areaId);
    const after = await tx.customer.update({ where: { id }, data });
    const openings = await applyOpeningBalances(tx, ctx, id, openingBalances);
    const diff = changedFields(before, after);
    if (Object.keys(openings).length > 0) {
      diff.oldValue.openingBalances = Object.fromEntries(
        Object.entries(openings).map(([k, v]) => [k, v.from]),
      );
      diff.newValue.openingBalances = Object.fromEntries(
        Object.entries(openings).map(([k, v]) => [k, v.to]),
      );
    }
    if (diff.changed || Object.keys(openings).length > 0) {
      await writeAudit(tx, ctx.user, {
        action: "UPDATE",
        entityType: "Customer",
        entityId: id,
        oldValue: diff.oldValue,
        newValue: diff.newValue,
      });
    }
    return after;
  });
}

/** For the credit-limit display: null = no limit. */
export function creditLimitText(limit: Prisma.Decimal | null) {
  return limit === null ? "No limit" : limit.toFixed(2);
}
