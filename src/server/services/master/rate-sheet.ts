import "server-only";

import { z } from "zod";

import { businessToday, toDateInput } from "@/lib/dates";
import { discountText, parseDiscount, parseSlabs, shortMoney, slabsText } from "@/lib/rate-sheet";
import { quantityText } from "@/lib/units";
import { idSchema, productSchema } from "@/lib/validation/master";

import { assertCan, can } from "../../auth/permissions";
import { ServiceError } from "../errors";
import type { ServiceCtx } from "./common";
import { updateProductTx } from "./products";

// Products → Edit rates (owner): every active product's rates, discount, quantity slabs and
// minimum stock in one sheet. A save goes through updateProductTx for each changed product, in
// one transaction (all or nothing), so it is checked, audited and added to the price history
// exactly as editing the product on its own page. New rates apply at once (effective today).

/** The sheet's editable columns. */
export const RATE_COLUMNS = ["purchaseRate", "saleRate", "discount", "slabs", "minStock"] as const;
export type RateColumn = (typeof RATE_COLUMNS)[number];
export type RateRow = {
  id: string;
  code: string;
  name: string;
  companyId: string;
  companyName: string;
} & Record<RateColumn, string>;

export async function getRateSheet(ctx: ServiceCtx) {
  assertCan(ctx.user.role, "rates.manage");
  // Purchase rates are cost figures: only for roles that see them (CLAUDE.md rule 8).
  const showCost = can(ctx.user.role, "financials.view");
  const products = await ctx.db.product.findMany({
    where: { isActive: true },
    include: {
      company: { select: { id: true, name: true } },
      discountTiers: { orderBy: { minQuantity: "asc" } },
    },
    orderBy: [{ company: { name: "asc" } }, { code: "asc" }],
  });
  const rows: RateRow[] = products.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    companyId: p.companyId,
    companyName: p.company.name,
    purchaseRate: showCost ? shortMoney(p.purchaseRate) : "",
    saleRate: shortMoney(p.saleRate),
    discount: discountText(p.discountType, p.discountValue),
    slabs: slabsText(p.discountTiers),
    minStock: p.minStockLevel ? quantityText(p.minStockLevel) : "",
  }));
  const companies = [...new Map(rows.map((r) => [r.companyId, r.companyName])).entries()].map(
    ([id, name]) => ({ id, name }),
  );
  // Changes after this moment (another user, a save) give the sheet a new version.
  const version = products.reduce((v, p) => Math.max(v, p.updatedAt.getTime()), 0);
  return { rows, companies, showCost, version: String(version) };
}

const changeSchema = z.object({
  productId: idSchema,
  purchaseRate: z.string().max(20).optional(),
  saleRate: z.string().max(20).optional(),
  discount: z.string().max(20).optional(),
  slabs: z.string().max(400).optional(),
  minStock: z.string().max(20).optional(),
});
const saveSchema = z.object({ changes: z.array(changeSchema).min(1).max(2000) });

/** Problems per product and column, shown on the sheet's cells; nothing is saved. */
export class RateSheetError extends ServiceError {
  constructor(public readonly cells: Record<string, string>) {
    const n = Object.keys(cells).length;
    super(`${n} ${n === 1 ? "cell needs" : "cells need"} fixing; nothing was saved.`);
  }
}

/** Where a product validation problem belongs on the sheet. */
function columnOf(path: PropertyKey[]): RateColumn {
  const field = String(path[0] ?? "");
  if (field === "purchaseRate" || field === "saleRate") return field;
  if (field === "slabs") return "slabs";
  if (field === "minStockLevel") return "minStock";
  return "discount";
}

export async function saveRateSheet(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "masterData.manage");
  assertCan(ctx.user.role, "rates.manage");
  const showCost = can(ctx.user.role, "financials.view");
  const { changes } = saveSchema.parse(input);

  const products = await ctx.db.product.findMany({
    where: { id: { in: changes.map((c) => c.productId) } },
    include: { discountTiers: { orderBy: { minQuantity: "asc" } } },
  });
  const byId = new Map(products.map((p) => [p.id, p]));
  const today = toDateInput(businessToday());
  const cells: Record<string, string> = {};
  const parsed: { id: string; input: z.infer<typeof productSchema> }[] = [];

  for (const c of changes) {
    const p = byId.get(c.productId);
    if (!p) throw new ServiceError("A product on the sheet was not found. Reload the sheet.");
    if (c.purchaseRate !== undefined && !showCost)
      throw new ServiceError("You cannot change purchase rates.");
    const fail = (column: RateColumn, message: string) => (cells[`${p.id}.${column}`] = message);

    const discount = parseDiscount(c.discount ?? discountText(p.discountType, p.discountValue));
    if (!discount.ok) fail("discount", discount.error);
    const slabs = parseSlabs(c.slabs ?? slabsText(p.discountTiers));
    if (!slabs.ok) fail("slabs", slabs.error);
    if (!discount.ok || !slabs.ok) continue;
    // Slabs are in the discount's unit: switching between % and Rs would silently turn
    // "Rs 15 per dozen" into "15%". Their numbers must be retyped for the new unit.
    const unit = (t: string) => (t === "PERCENT" ? "%" : t === "NONE" ? null : "Rs");
    if (
      c.discount !== undefined &&
      c.slabs === undefined &&
      p.discountTiers.length > 0 &&
      unit(discount.discountType) !== null &&
      unit(p.discountType) !== null &&
      unit(discount.discountType) !== unit(p.discountType)
    ) {
      fail(
        "slabs",
        discount.discountType === "PERCENT"
          ? "These slabs are in Rs per dozen; with a % discount, retype them in % (e.g. 25=3)"
          : "These slabs are in %; with a Rs discount, retype them in Rs per dozen",
      );
      continue;
    }
    if (discount.discountType === "NONE" && slabs.slabs.length > 0) {
      fail("slabs", "Quantity slabs need a discount type: give the product a discount first");
      continue;
    }

    const result = productSchema.safeParse({
      companyId: p.companyId,
      code: p.code,
      name: p.name,
      shortName: p.shortName ?? "",
      purchaseRate: c.purchaseRate ?? shortMoney(p.purchaseRate),
      saleRate: c.saleRate ?? shortMoney(p.saleRate),
      discountType: discount.discountType,
      discountValue: discount.discountValue,
      slabs: slabs.slabs,
      minStockLevel: c.minStock ?? (p.minStockLevel ? quantityText(p.minStockLevel) : ""),
      effectiveFrom: today,
    });
    if (!result.success) {
      for (const issue of result.error.issues) fail(columnOf(issue.path), issue.message);
      continue;
    }
    parsed.push({ id: p.id, input: result.data });
  }
  if (Object.keys(cells).length > 0) throw new RateSheetError(cells);

  const saved = await ctx.db.$transaction(
    async (tx) => {
      let n = 0;
      for (const { id, input } of parsed) {
        const { changed } = await updateProductTx(tx, ctx, id, input);
        if (changed) n += 1;
      }
      return n;
    },
    { timeout: 60_000 },
  );
  return { saved };
}
