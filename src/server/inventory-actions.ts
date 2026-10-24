"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionState } from "@/lib/action-state";

import { runAction } from "./actions";
import { requireTenantContext } from "./auth/session";
import { returnDamagedStock, setOpeningStock } from "./services/inventory";

/** Damaged stock sent back to its company (stock only; the credit was the damage claim). */
export async function returnDamagedStockAction(
  productId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("operations.manage");
    await returnDamagedStock(ctx, {
      productId,
      quantity: formData.get("quantity"),
      returnDate: formData.get("returnDate"),
      note: formData.get("note"),
      requestId: formData.get("requestId"),
    });
  }, formData);
  if (result.status !== "success") return result;
  revalidatePath("/inventory");
  redirect(`/inventory/${productId}?notice=damaged-returned`);
}

/** Saves the opening stock sheet (only rows whose quantity changed are sent). */
export async function saveOpeningStockAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let changed = 0;
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("masterData.manage");
    const productIds = formData.getAll("productId").map(String);
    const quantities = formData.getAll("quantity").map(String);
    changed = (
      await setOpeningStock(ctx, {
        requestId: formData.get("requestId"),
        stockDate: formData.get("stockDate"),
        lines: productIds.map((productId, i) => ({ productId, quantity: quantities[i] ?? "" })),
      })
    ).changed;
  }, formData);
  if (result.status !== "success") return result;
  revalidatePath("/inventory");
  return {
    status: "success",
    message:
      changed === 0
        ? "Nothing changed."
        : `Opening stock saved for ${changed} ${changed === 1 ? "product" : "products"}.`,
  };
}
