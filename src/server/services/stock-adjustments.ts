import "server-only";

import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import type { ApprovalStatus, StockAdjustmentReason } from "@/generated/prisma/enums";
import { takeFromBatches } from "@/lib/delivery";
import { icontains, matchEveryWord } from "@/lib/list-params";
import { formatDozens } from "@/lib/units";
import {
  blankToUndefined,
  optionalText,
  packetsSchema,
  recordIdSchema,
  requestIdSchema,
} from "@/lib/validation/master";

import { writeAudit } from "../audit";
import { assertCan, can } from "../auth/permissions";
import type { TenantTx } from "../db/tenant";
import { ServiceError } from "./errors";
import { PAGE_SIZE, paged, type ServiceCtx } from "./master/common";
import { batchBalances, found } from "./posting";
import type { DateRange } from "./purchasing/filters";

// Stock adjustments (SPEC §5): when the shelf and the books disagree.
// - SHORT: fewer than recorded (counting error, theft, other): out of saleable stock.
// - EXTRA: more than recorded: into saleable stock.
// - DAMAGED: damaged in the warehouse: from saleable into damaged stock (our loss, not a company
//   claim; it can still be sent back to the company from damaged stock).
// Staff requests stay pending until the owner approves or rejects them; the owner's own are
// approved at once. Only an approved adjustment moves stock (ADJUSTMENT movements, referencing the
// adjustment). Quantities in packets.

export const ADJUSTMENT_KINDS = ["SHORT", "EXTRA", "DAMAGED"] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const ADJUSTMENT_KIND_LABEL: Record<AdjustmentKind, string> = {
  SHORT: "Short (fewer than recorded)",
  EXTRA: "Extra found",
  DAMAGED: "Damaged in warehouse",
};
export const ADJUSTMENT_REASON_LABEL: Record<StockAdjustmentReason, string> = {
  COUNTING_ERROR: "Counting error",
  THEFT: "Theft",
  DAMAGED: "Damaged in warehouse",
  OTHER: "Other",
};

export const adjustmentSchema = z
  .object({
    requestId: requestIdSchema,
    productId: z.string({ error: "Choose the product" }).min(1, "Choose the product").max(40),
    kind: z.enum(ADJUSTMENT_KINDS, { error: "Choose what happened" }),
    reason: z
      .preprocess(blankToUndefined, z.enum(["COUNTING_ERROR", "THEFT", "OTHER"]).optional())
      .transform((v) => v ?? null),
    quantity: packetsSchema("quantity", { min: 1 }),
    note: optionalText(300),
  })
  .superRefine((d, ctx) => {
    if (d.kind !== "DAMAGED" && !d.reason)
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Choose the reason" });
    if (d.kind === "EXTRA" && d.reason === "THEFT")
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Theft only makes stock short" });
    if (d.reason === "OTHER" && !d.note)
      ctx.addIssue({ code: "custom", path: ["note"], message: "Say what happened" });
  });

/** The kind of an adjustment as stored: sign of the quantity plus the DAMAGED reason. */
export function adjustmentKind(a: {
  quantity: number;
  reason: StockAdjustmentReason;
}): AdjustmentKind {
  return a.reason === "DAMAGED" ? "DAMAGED" : a.quantity < 0 ? "SHORT" : "EXTRA";
}

export async function requestAdjustment(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "stock.requestAdjustment");
  const data = adjustmentSchema.parse(input);
  const approveNow = can(ctx.user.role, "stock.approveAdjustment");
  // Serializable: an adjustment approved at once checks stock that a dispatch may be taking.
  return ctx.db.$transaction(
    async (tx) => {
      if (data.requestId) {
        const existing = await tx.stockAdjustment.findUnique({
          where: {
            tenantId_requestId: { tenantId: ctx.user.tenantId, requestId: data.requestId },
          },
        });
        if (existing) return existing;
      }
      const product = found(
        await tx.product.findUnique({
          where: { id: data.productId },
          select: { id: true, name: true, company: { select: { warehouseId: true } } },
        }),
        "product",
      );
      const adjustment = await tx.stockAdjustment.create({
        data: {
          tenantId: ctx.user.tenantId,
          productId: product.id,
          warehouseId: product.company.warehouseId,
          bucket: "SALEABLE",
          quantity: data.kind === "EXTRA" ? data.quantity : -data.quantity,
          reason: data.kind === "DAMAGED" ? "DAMAGED" : data.reason!,
          note: data.note,
          requestedById: ctx.user.id,
          requestId: data.requestId,
        },
      });
      await writeAudit(tx, ctx.user, {
        action: "CREATE",
        entityType: "StockAdjustment",
        entityId: adjustment.id,
        newValue: adjustment,
        requestId: data.requestId,
      });
      return approveNow ? decide(tx, ctx, adjustment.id, "APPROVED") : adjustment;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function approveAdjustment(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "stock.approveAdjustment");
  const { id } = recordIdSchema.parse(input);
  return ctx.db.$transaction((tx) => decide(tx, ctx, id, "APPROVED"), {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

export async function rejectAdjustment(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "stock.approveAdjustment");
  const { id } = recordIdSchema.parse(input);
  return ctx.db.$transaction((tx) => decide(tx, ctx, id, "REJECTED"));
}

async function decide(
  tx: TenantTx,
  ctx: ServiceCtx,
  id: string,
  status: Exclude<ApprovalStatus, "PENDING">,
) {
  const adjustment = found(
    await tx.stockAdjustment.findUnique({
      where: { id },
      include: { product: { select: { name: true } } },
    }),
    "stock adjustment",
  );
  const claimed = await tx.stockAdjustment.updateMany({
    where: { id, status: "PENDING" },
    data: { status, decidedById: ctx.user.id, decidedAt: new Date() },
  });
  if (claimed.count === 0)
    throw new ServiceError(`This adjustment is already ${adjustment.status.toLowerCase()}.`);
  if (status === "APPROVED") await applyAdjustment(tx, ctx, adjustment);
  await writeAudit(tx, ctx.user, {
    action: status === "APPROVED" ? "APPROVE" : "REJECT",
    entityType: "StockAdjustment",
    entityId: id,
    oldValue: { status: "PENDING" },
    newValue: { status },
  });
  return { ...adjustment, status };
}

/** Posts the stock movements of an approved adjustment. */
async function applyAdjustment(
  tx: TenantTx,
  ctx: ServiceCtx,
  a: {
    id: string;
    productId: string;
    warehouseId: string;
    quantity: number;
    reason: StockAdjustmentReason;
    note: string | null;
    product: { name: string };
  },
) {
  const move = (bucket: "SALEABLE" | "DAMAGED", quantity: number, batchId: string | null) =>
    tx.stockMovement.create({
      data: {
        tenantId: ctx.user.tenantId,
        type: "ADJUSTMENT",
        productId: a.productId,
        warehouseId: a.warehouseId,
        batchId,
        bucket,
        quantity,
        referenceType: "StockAdjustment",
        referenceId: a.id,
        note: `${ADJUSTMENT_REASON_LABEL[a.reason]}${a.note ? `: ${a.note}` : ""}`,
        createdById: ctx.user.id,
      },
    });

  if (a.quantity > 0) {
    await move("SALEABLE", a.quantity, null);
    return;
  }
  const out = -a.quantity;
  const onHand = await tx.stockMovement.aggregate({
    where: { productId: a.productId, warehouseId: a.warehouseId, bucket: "SALEABLE" },
    _sum: { quantity: true },
  });
  const have = onHand._sum.quantity ?? 0;
  if (out > have)
    throw new ServiceError(
      `Only ${formatDozens(Math.max(have, 0))} of ${a.product.name} is in stock, so ${formatDozens(out)} can't come out.`,
    );
  // Oldest batches first, like dispatch, so batch balances stay right.
  const batches = await tx.batch.findMany({
    where: { productId: a.productId, warehouseId: a.warehouseId },
    orderBy: [{ receivedDate: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const balances = await batchBalances(
    tx,
    batches.map((b) => b.id),
  );
  const { slices, unbatched } = takeFromBatches(
    out,
    batches.map((b) => ({ id: b.id, available: balances.get(b.id) ?? 0 })),
  );
  for (const s of slices) await move("SALEABLE", -s.quantity, s.batchId);
  if (unbatched > 0) await move("SALEABLE", -unbatched, null);
  if (a.reason === "DAMAGED") await move("DAMAGED", out, null);
}

export type AdjustmentFilters = { q?: string; status?: string; page: number } & DateRange;

const STATUSES: ApprovalStatus[] = ["PENDING", "APPROVED", "REJECTED"];

export async function listAdjustments(ctx: ServiceCtx, f: AdjustmentFilters) {
  assertCan(ctx.user.role, "stock.requestAdjustment");
  const where: Prisma.StockAdjustmentWhereInput = {
    ...(f.status && STATUSES.includes(f.status as ApprovalStatus)
      ? { status: f.status as ApprovalStatus }
      : {}),
    ...(f.from || f.to
      ? {
          createdAt: {
            ...(f.from ? { gte: f.from } : {}),
            // `to` is a business date: include the whole day.
            ...(f.to ? { lt: new Date(f.to.getTime() + 86_400_000) } : {}),
          },
        }
      : {}),
    ...matchEveryWord(f.q, (w): Prisma.StockAdjustmentWhereInput[] => [
      { product: { code: icontains(w) } },
      { product: { name: icontains(w) } },
      { note: icontains(w) },
    ]),
  };
  const [rows, total, pending] = await Promise.all([
    ctx.db.stockAdjustment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        product: { select: { code: true, name: true } },
        warehouse: { select: { name: true } },
      },
    }),
    ctx.db.stockAdjustment.count({ where }),
    ctx.db.stockAdjustment.count({ where: { status: "PENDING" } }),
  ]);
  const userIds = [
    ...new Set(rows.flatMap((r) => [r.requestedById, r.decidedById]).filter(Boolean)),
  ] as string[];
  const users = await ctx.db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });
  const userName = new Map(users.map((u) => [u.id, u.name]));
  return {
    ...paged(
      rows.map((r) => ({
        ...r,
        kind: adjustmentKind(r),
        requestedBy: r.requestedById ? (userName.get(r.requestedById) ?? "") : "",
        decidedBy: r.decidedById ? (userName.get(r.decidedById) ?? "") : "",
      })),
      total,
      f.page,
    ),
    pending,
  };
}

/** Products to choose from, with what is in stock now (for the adjustment form). */
export async function adjustmentFormOptions(ctx: ServiceCtx) {
  assertCan(ctx.user.role, "stock.requestAdjustment");
  const products = await ctx.db.product.findMany({
    where: { isActive: true },
    orderBy: { code: "asc" },
    select: { id: true, code: true, name: true, company: { select: { warehouseId: true } } },
  });
  const stock = await ctx.db.stockMovement.groupBy({
    by: ["productId", "warehouseId", "bucket"],
    _sum: { quantity: true },
  });
  const qty = (productId: string, warehouseId: string, bucket: "SALEABLE" | "DAMAGED") =>
    stock.find(
      (s) => s.productId === productId && s.warehouseId === warehouseId && s.bucket === bucket,
    )?._sum.quantity ?? 0;
  return products.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    onHand: qty(p.id, p.company.warehouseId, "SALEABLE"),
    damaged: qty(p.id, p.company.warehouseId, "DAMAGED"),
  }));
}
