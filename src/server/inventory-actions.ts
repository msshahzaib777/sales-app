"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionState } from "@/lib/action-state";

import { runAction } from "./actions";
import { requireTenantContext } from "./auth/session";
import { returnDamagedStock } from "./services/inventory";

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
