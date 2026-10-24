import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { filterParam, type ListParams, searchWhere, statusWhere } from "@/lib/list-params";
import { productSchema, type ProductInput } from "@/lib/validation/master";

import { writeAudit } from "../../audit";
import { assertCan, can } from "../../auth/permissions";
import type { TenantTx } from "../../db/tenant";
import { ServiceError } from "../errors";
import { changedFields, PAGE_SIZE, paged, type ServiceCtx, withUniqueMessage } from "./common";

const DUPLICATE = "Another product already uses this code.";

type SlabView = { minQuantity: number; discountType: string; discountValue: string };

/** Slabs use the base discount's unit (PKR per dozen, or percent). */
function slabsFor(input: ProductInput): SlabView[] {
  const type = input.discountType === "PERCENT" ? "PERCENT" : "AMOUNT_PER_UNIT";
  return [...input.slabs]
    .sort((a, b) => a.fromDozens - b.fromDozens)
    .map((s) => ({
      minQuantity: s.fromDozens,
      discountType: type,
      discountValue: new Prisma.Decimal(s.value).toFixed(2),
    }));
}

const money = (v: Prisma.Decimal | string) => new Prisma.Decimal(v).toFixed(2);

/** The pricing part of a product, compared to decide whether a price-history row is needed. */
function pricing(
  p: {
    purchaseRate: Prisma.Decimal | string;
    saleRate: Prisma.Decimal | string;
    discountType: string;
    discountValue: Prisma.Decimal | string;
  },
  slabs: SlabView[],
) {
  return {
    purchaseRate: money(p.purchaseRate),
    saleRate: money(p.saleRate),
    discountType: p.discountType,
    discountValue: money(p.discountValue),
    slabs,
  };
}

/**
 * Product list. Everyone can see it (order entry), but purchase rates are only returned to roles
 * with `financials.view` (CLAUDE.md rule 8: staff never see purchase cost).
 */
export async function listProducts(
  ctx: ServiceCtx,
  params: ListParams,
  filters: Record<string, unknown> = {},
) {
  const companyId = filterParam(filters, "companyId");
  const where = {
    ...statusWhere(params.status),
    ...searchWhere(params.q, ["name", "code"]),
    ...(companyId ? { companyId } : {}),
  };
  const showCost = can(ctx.user.role, "financials.view");
  const [rows, total] = await Promise.all([
    ctx.db.product.findMany({
      where,
      orderBy: [{ company: { name: "asc" } }, { code: "asc" }],
      skip: (params.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        company: { select: { name: true } },
        discountTiers: { orderBy: { minQuantity: "asc" } },
      },
    }),
    ctx.db.product.count({ where }),
  ]);
  return paged(
    rows.map(({ purchaseRate, ...row }) => ({
      ...row,
      purchaseRate: showCost ? purchaseRate : null,
    })),
    total,
    params.page,
  );
}

export async function getProduct(ctx: ServiceCtx, id: string) {
  assertCan(ctx.user.role, "masterData.manage");
  const row = await ctx.db.product.findUnique({
    where: { id },
    include: {
      discountTiers: { orderBy: { minQuantity: "asc" } },
      priceHistory: { orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }], take: 20 },
    },
  });
  if (!row) throw new ServiceError("This product was not found.");
  return row;
}

async function assertCompany(tx: TenantTx, companyId: string) {
  const company = await tx.company.findUnique({ where: { id: companyId } });
  if (!company || !company.isActive) throw new ServiceError("Choose an active company.");
}

async function writeSlabs(tx: TenantTx, ctx: ServiceCtx, productId: string, slabs: SlabView[]) {
  await tx.productDiscountTier.deleteMany({ where: { productId } });
  if (slabs.length > 0) {
    await tx.productDiscountTier.createMany({
      data: slabs.map((s) => ({
        tenantId: ctx.user.tenantId,
        productId,
        minQuantity: s.minQuantity,
        discountType: s.discountType as "PERCENT" | "AMOUNT_PER_UNIT",
        discountValue: s.discountValue,
      })),
    });
  }
}

async function appendPriceHistory(
  tx: TenantTx,
  ctx: ServiceCtx,
  productId: string,
  input: ProductInput,
  slabs: SlabView[],
) {
  await tx.productPriceHistory.create({
    data: {
      tenantId: ctx.user.tenantId,
      productId,
      purchaseRate: input.purchaseRate,
      saleRate: input.saleRate,
      discountType: input.discountType,
      discountValue: input.discountValue,
      discountTiers: slabs,
      effectiveFrom: input.effectiveFrom,
      createdById: ctx.user.id,
    },
  });
}

/** Creates a product inside the caller's transaction (also used by the import). */
export async function createProductTx(
  tx: TenantTx,
  ctx: ServiceCtx,
  parsed: ProductInput,
  requestId?: string,
) {
  const { requestId: _r, slabs: _slabs, effectiveFrom: _from, ...data } = parsed;
  const slabs = slabsFor(parsed);
  if (requestId) {
    const existing = await tx.product.findUnique({
      where: { tenantId_requestId: { tenantId: ctx.user.tenantId, requestId } },
    });
    if (existing) return existing;
  }
  await assertCompany(tx, data.companyId);
  const created = await withUniqueMessage(DUPLICATE, () =>
    tx.product.create({ data: { tenantId: ctx.user.tenantId, requestId, ...data } }),
  );
  await writeSlabs(tx, ctx, created.id, slabs);
  await appendPriceHistory(tx, ctx, created.id, parsed, slabs);
  await writeAudit(tx, ctx.user, {
    action: "CREATE",
    entityType: "Product",
    entityId: created.id,
    newValue: { ...created, slabs },
    requestId,
  });
  return created;
}

export async function createProduct(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "masterData.manage");
  assertCan(ctx.user.role, "rates.manage");
  const parsed = productSchema.parse(input);
  return ctx.db.$transaction((tx) => createProductTx(tx, ctx, parsed, parsed.requestId));
}

/**
 * Updates a product inside the caller's transaction. A change to rates, discount or slabs needs
 * `rates.manage` and appends a ProductPriceHistory row effective from `effectiveFrom`.
 */
export async function updateProductTx(
  tx: TenantTx,
  ctx: ServiceCtx,
  id: string,
  parsed: ProductInput,
) {
  const { requestId: _r, slabs: _slabs, effectiveFrom: _from, ...data } = parsed;
  const slabs = slabsFor(parsed);
  const before = await tx.product.findUnique({
    where: { id },
    include: { discountTiers: { orderBy: { minQuantity: "asc" } } },
  });
  if (!before) throw new ServiceError("This product was not found.");

  if (before.companyId !== data.companyId) {
    const used =
      (await tx.stockMovement.count({ where: { productId: id } })) +
      (await tx.salesOrderLine.count({ where: { productId: id } }));
    if (used > 0)
      throw new ServiceError(
        "This product already has stock or orders, so its company cannot change.",
      );
    await assertCompany(tx, data.companyId);
  }

  const beforeSlabs = before.discountTiers.map((t) => ({
    minQuantity: t.minQuantity,
    discountType: t.discountType,
    discountValue: money(t.discountValue),
  }));
  const ratesChanged =
    JSON.stringify(pricing(before, beforeSlabs)) !== JSON.stringify(pricing(parsed, slabs));
  if (ratesChanged) assertCan(ctx.user.role, "rates.manage");

  const { discountTiers: _tiers, ...beforeRow } = before;
  const after = await withUniqueMessage(DUPLICATE, () =>
    tx.product.update({ where: { id }, data }),
  );
  if (ratesChanged) {
    await writeSlabs(tx, ctx, id, slabs);
    await appendPriceHistory(tx, ctx, id, parsed, slabs);
  }
  const diff = changedFields({ ...beforeRow, slabs: beforeSlabs }, { ...after, slabs });
  if (diff.changed) {
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "Product",
      entityId: id,
      oldValue: diff.oldValue,
      newValue: diff.newValue,
    });
  }
  return { product: after, changed: diff.changed, ratesChanged };
}

export async function updateProduct(ctx: ServiceCtx, id: string, input: unknown) {
  assertCan(ctx.user.role, "masterData.manage");
  const parsed = productSchema.parse(input);
  const { product } = await ctx.db.$transaction((tx) => updateProductTx(tx, ctx, id, parsed));
  return product;
}
