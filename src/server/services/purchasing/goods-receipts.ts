import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { businessToday } from "@/lib/dates";
import { HALF_DOZENS_PER_DOZEN } from "@/lib/units";
import { goodsReceiptSchema, reverseSchema } from "@/lib/validation/purchasing";

import { writeAudit } from "../../audit";
import { assertCan, can } from "../../auth/permissions";
import { ServiceError } from "../errors";
import { PAGE_SIZE, paged, type ServiceCtx } from "../master/common";
import {
  batchBalances,
  found,
  nextDocumentNumber,
  postCompanyLedger,
  reverseLedgerFor,
} from "../posting";
import { calculateLineAmounts } from "@/lib/pricing";
import { addDays, claimsToDeduct } from "./calc";
import type { DateRange } from "./filters";
import { refreshPurchaseOrderStatus } from "./purchase-orders";

// Goods receipt = stock arriving from a company. Posting it, in one transaction:
//  1. saves the receipt and its lines (received can be less or more than ordered);
//  2. adds each line as a new batch with a GOODS_RECEIPT stock movement;
//  3. creates the company bill at the purchase rate, deducting pending damage claims;
//  4. credits the company ledger with the bill's gross amount (claims were debited when logged);
//  5. updates the purchase order's status.
// A posted receipt is never edited; a mistake is cancelled by reversal (cancelGoodsReceipt).

export type ReceiptFilters = { companyId?: string; q?: string; page: number } & DateRange;

export async function listGoodsReceipts(ctx: ServiceCtx, f: ReceiptFilters) {
  assertCan(ctx.user.role, "operations.manage");
  const number = f.q && /^\d+$/.test(f.q) ? Number(f.q) : undefined;
  const where: Prisma.GoodsReceiptWhereInput = {
    ...(f.companyId ? { companyId: f.companyId } : {}),
    ...(f.from || f.to
      ? { receivedDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
      : {}),
    ...(f.q
      ? number
        ? { number }
        : {
            OR: [
              { supplierRef: { contains: f.q, mode: "insensitive" } },
              { company: { name: { contains: f.q, mode: "insensitive" } } },
            ],
          }
      : {}),
  };
  const showCost = can(ctx.user.role, "financials.view");
  const [rows, total] = await Promise.all([
    ctx.db.goodsReceipt.findMany({
      where,
      orderBy: [{ receivedDate: "desc" }, { number: "desc" }],
      skip: (f.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        company: { select: { name: true } },
        purchaseOrder: { select: { number: true } },
        companyBill: { select: { id: true, number: true, netAmount: true } },
        lines: { select: { quantity: true } },
      },
    }),
    ctx.db.goodsReceipt.count({ where }),
  ]);
  return paged(
    rows.map(({ lines, companyBill, ...r }) => ({
      ...r,
      receivedQty: lines.reduce((s, l) => s + l.quantity, 0),
      bill: companyBill
        ? {
            id: companyBill.id,
            number: companyBill.number,
            netAmount: showCost ? companyBill.netAmount : null,
          }
        : null,
    })),
    total,
    f.page,
  );
}

export async function getGoodsReceipt(ctx: ServiceCtx, id: string) {
  assertCan(ctx.user.role, "operations.manage");
  const receipt = found(
    await ctx.db.goodsReceipt.findUnique({
      where: { id },
      include: {
        company: { select: { name: true } },
        warehouse: { select: { name: true } },
        purchaseOrder: { select: { id: true, number: true } },
        companyBill: {
          select: {
            id: true,
            number: true,
            grossAmount: true,
            claimDeduction: true,
            netAmount: true,
            dueDate: true,
          },
        },
        lines: {
          include: { product: { select: { code: true, name: true } } },
          orderBy: { product: { code: "asc" } },
        },
      },
    }),
    "goods receipt",
  );
  const showCost = can(ctx.user.role, "financials.view");
  return {
    ...receipt,
    lines: receipt.lines.map(({ rate, amount, ...l }) => ({
      ...l,
      rate: showCost ? rate : null,
      amount: showCost ? amount : null,
    })),
    companyBill: receipt.companyBill && showCost ? receipt.companyBill : null,
    billId: receipt.companyBill?.id ?? null,
  };
}

export async function createGoodsReceipt(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "operations.manage");
  const data = goodsReceiptSchema.parse(input);
  const showCost = can(ctx.user.role, "financials.view");
  const mayOverrideDue = can(ctx.user.role, "payments.manage");

  return ctx.db.$transaction(
    async (tx) => {
      if (data.requestId) {
        const existing = await tx.goodsReceipt.findUnique({
          where: { tenantId_requestId: { tenantId: ctx.user.tenantId, requestId: data.requestId } },
          include: { companyBill: true },
        });
        // Every receipt is posted together with its bill.
        if (existing) return { ...existing, companyBill: existing.companyBill! };
      }

      const company = await tx.company.findUnique({ where: { id: data.companyId } });
      if (!company || !company.isActive) throw new ServiceError("Choose an active company.");

      const po = data.purchaseOrderId
        ? await tx.purchaseOrder.findUnique({
            where: { id: data.purchaseOrderId },
            include: { lines: true },
          })
        : null;
      if (data.purchaseOrderId) {
        if (!po || po.companyId !== company.id)
          throw new ServiceError("The purchase order does not belong to this company.");
        if (po.status !== "OPEN" && po.status !== "PARTIALLY_RECEIVED") {
          throw new ServiceError(
            `Purchase order #${po.number} is ${po.status.toLowerCase().replace("_", " ")}.`,
          );
        }
      }
      const poLineByProduct = new Map((po?.lines ?? []).map((l) => [l.productId, l]));

      const products = await tx.product.findMany({
        where: { id: { in: data.lines.map((l) => l.productId) } },
      });
      const productById = new Map(products.map((p) => [p.id, p]));
      for (const line of data.lines) {
        const p = productById.get(line.productId);
        if (!p || p.companyId !== company.id)
          throw new ServiceError("Every product must belong to the chosen company.");
      }

      // Rate: typed (cost-visible roles) → purchase-order rate → product purchase rate.
      const lines = data.lines.map((line) => {
        const product = productById.get(line.productId)!;
        const poLine = poLineByProduct.get(line.productId);
        const rate =
          showCost && line.rate !== null
            ? new Prisma.Decimal(line.rate)
            : (poLine?.rate ?? product.purchaseRate);
        const { netAmount } = calculateLineAmounts({
          quantity: line.quantity,
          baseUnitsPerPriceUnit: HALF_DOZENS_PER_DOZEN,
          rate,
        });
        return { product, poLine, quantity: line.quantity, rate, amount: netAmount };
      });
      const gross = lines.reduce((sum, l) => sum.add(l.amount), new Prisma.Decimal(0));

      const receipt = await tx.goodsReceipt.create({
        data: {
          tenantId: ctx.user.tenantId,
          number: await nextDocumentNumber(tx, ctx, "GOODS_RECEIPT"),
          purchaseOrderId: po?.id ?? null,
          companyId: company.id,
          warehouseId: company.warehouseId,
          receivedDate: data.receivedDate,
          supplierRef: data.supplierRef,
          note: data.note,
          requestId: data.requestId,
          createdById: ctx.user.id,
        },
      });

      for (const line of lines) {
        const receiptLine = await tx.goodsReceiptLine.create({
          data: {
            tenantId: ctx.user.tenantId,
            goodsReceiptId: receipt.id,
            purchaseOrderLineId: line.poLine?.id ?? null,
            productId: line.product.id,
            quantity: line.quantity,
            rate: line.rate,
            amount: line.amount,
          },
        });
        const batch = await tx.batch.create({
          data: {
            tenantId: ctx.user.tenantId,
            productId: line.product.id,
            warehouseId: company.warehouseId,
            goodsReceiptLineId: receiptLine.id,
            receivedDate: data.receivedDate,
          },
        });
        await tx.stockMovement.create({
          data: {
            tenantId: ctx.user.tenantId,
            type: "GOODS_RECEIPT",
            productId: line.product.id,
            warehouseId: company.warehouseId,
            batchId: batch.id,
            bucket: "SALEABLE",
            quantity: line.quantity,
            occurredAt: data.receivedDate,
            referenceType: "GoodsReceipt",
            referenceId: receipt.id,
            createdById: ctx.user.id,
          },
        });
      }

      // Pending damage claims are deducted on this bill (SPEC §4), whole claims only.
      const pending = await tx.companyClaim.findMany({
        where: { companyId: company.id, status: "PENDING" },
      });
      const deduction = claimsToDeduct(gross, pending);

      const bill = await tx.companyBill.create({
        data: {
          tenantId: ctx.user.tenantId,
          number: await nextDocumentNumber(tx, ctx, "COMPANY_BILL"),
          companyId: company.id,
          goodsReceiptId: receipt.id,
          billDate: data.receivedDate,
          dueDate:
            mayOverrideDue && data.dueDate
              ? data.dueDate
              : addDays(data.receivedDate, company.paymentTermsDays),
          grossAmount: gross,
          claimDeduction: deduction.total,
          netAmount: gross.sub(deduction.total),
          createdById: ctx.user.id,
        },
      });
      if (deduction.ids.length > 0) {
        await tx.companyClaim.updateMany({
          where: { id: { in: deduction.ids } },
          data: { status: "APPLIED", appliedToBillId: bill.id },
        });
      }
      await postCompanyLedger(tx, ctx, {
        companyId: company.id,
        type: "COMPANY_BILL",
        entryDate: data.receivedDate,
        credit: gross,
        description: `Bill #${bill.number} for goods receipt #${receipt.number}`,
        referenceType: "CompanyBill",
        referenceId: bill.id,
      });

      if (po) await refreshPurchaseOrderStatus(tx, po.id);

      await writeAudit(tx, ctx.user, {
        action: "POST",
        entityType: "GoodsReceipt",
        entityId: receipt.id,
        newValue: {
          number: receipt.number,
          companyId: company.id,
          purchaseOrderId: po?.id ?? null,
          receivedDate: data.receivedDate,
          lines: lines.map((l) => ({
            productId: l.product.id,
            quantity: l.quantity,
            rate: l.rate,
          })),
          bill: {
            number: bill.number,
            gross,
            claimDeduction: deduction.total,
            dueDate: bill.dueDate,
          },
        },
        requestId: data.requestId,
      });
      return { ...receipt, companyBill: bill };
    },
    // Serializable: two receipts at once must not both deduct the same pending claim.
    { timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

/**
 * Cancels a receipt entered by mistake, by reversal: negative stock movements, a reversing ledger
 * entry for the bill, claims back to pending. Only possible while its stock is untouched and
 * nothing has been paid on its bill.
 */
export async function cancelGoodsReceipt(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "documents.reverse");
  const { id, reason } = reverseSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const receipt = found(
      await tx.goodsReceipt.findUnique({
        where: { id },
        include: { lines: { include: { batch: true } }, companyBill: true },
      }),
      "goods receipt",
    );
    if (receipt.status !== "POSTED") throw new ServiceError("This receipt is already cancelled.");
    const bill = receipt.companyBill!;
    const paid = await tx.companyPaymentAllocation.count({
      where: { companyBillId: bill.id, companyPayment: { status: "POSTED" } },
    });
    if (paid > 0)
      throw new ServiceError(
        `Bill #${bill.number} already has payments. Reverse those payments first.`,
      );

    const balances = await batchBalances(
      tx,
      receipt.lines.map((l) => l.batch!.id),
    );
    for (const line of receipt.lines) {
      if ((balances.get(line.batch!.id) ?? 0) < line.quantity) {
        throw new ServiceError(
          "Some of this stock has already been dispatched or adjusted, so the receipt cannot be cancelled.",
        );
      }
    }

    const today = businessToday();
    const movements = await tx.stockMovement.findMany({
      where: { referenceType: "GoodsReceipt", referenceId: id, type: "GOODS_RECEIPT" },
    });
    for (const m of movements) {
      await tx.stockMovement.create({
        data: {
          tenantId: ctx.user.tenantId,
          type: "REVERSAL",
          productId: m.productId,
          warehouseId: m.warehouseId,
          batchId: m.batchId,
          bucket: m.bucket,
          quantity: -m.quantity,
          referenceType: "GoodsReceipt",
          referenceId: id,
          reversalOfId: m.id,
          note: reason,
          createdById: ctx.user.id,
        },
      });
    }
    await reverseLedgerFor(
      tx,
      ctx,
      { type: "CompanyBill", id: bill.id },
      today,
      `Cancelled receipt #${receipt.number}: ${reason}`,
    );
    await tx.companyClaim.updateMany({
      where: { appliedToBillId: bill.id },
      data: { status: "PENDING", appliedToBillId: null },
    });
    await tx.companyBill.update({ where: { id: bill.id }, data: { status: "REVERSED" } });
    const after = await tx.goodsReceipt.update({
      where: { id },
      data: { status: "REVERSED", reversedAt: new Date(), reversalReason: reason },
    });
    if (receipt.purchaseOrderId) await refreshPurchaseOrderStatus(tx, receipt.purchaseOrderId);
    await writeAudit(tx, ctx.user, {
      action: "REVERSE",
      entityType: "GoodsReceipt",
      entityId: id,
      oldValue: { status: "POSTED" },
      newValue: { status: "REVERSED", reason, billNumber: bill.number },
    });
    return after;
  });
}
