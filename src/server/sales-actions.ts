"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionState } from "@/lib/action-state";

import { runAction } from "./actions";
import { requireTenantContext } from "./auth/session";
import { ServiceError } from "./services/errors";
import {
  approveCreditOverride,
  cancelSalesOrder,
  createSalesOrder,
  orderEntryContext,
  type OrderEntryContext,
  updateSalesOrder,
} from "./services/sales/orders";

// Server actions for sales orders. The services check permissions, price, validate and audit.

/** Loads the order screen's customer panel and product list when a customer is picked. */
export async function orderEntryContextAction(
  customerId: string,
  opts: { warehouseId?: string; excludeOrderId?: string } = {},
): Promise<OrderEntryContext | { error: string }> {
  try {
    const ctx = await requireTenantContext("operations.manage");
    return await orderEntryContext(ctx, customerId, opts);
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }
}

function orderInput(formData: FormData) {
  const fields: Record<string, string> = {};
  for (const [key, value] of formData) {
    if (
      typeof value === "string" &&
      !key.startsWith("$ACTION") &&
      key !== "productId" &&
      key !== "quantity"
    )
      fields[key] = value;
  }
  const ids = formData.getAll("productId").map(String);
  const quantities = formData.getAll("quantity").map(String);
  const lines = ids.map((productId, i) => ({ productId, quantity: quantities[i] ?? "" }));
  return { ...fields, lines };
}

/** Books (id = null) or edits an order, then opens it (or a blank order for "Save and next"). */
export async function saveSalesOrderAction(
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let savedId = "";
  let deliveryDate = "";
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("operations.manage");
    const saved = id
      ? await updateSalesOrder(ctx, id, orderInput(formData))
      : await createSalesOrder(ctx, orderInput(formData));
    savedId = saved.id;
    // Validated by the save; a YYYY-MM-DD date.
    deliveryDate = String(formData.get("deliveryDate") ?? "");
  }, formData);
  if (result.status !== "success") return result;
  revalidatePath("/orders");
  redirect(
    formData.get("intent") === "next"
      ? // The next order keeps this one's delivery date.
        `/orders/new?notice=booked&last=${savedId}&date=${deliveryDate}`
      : `/orders/${savedId}?notice=${id ? "saved" : "booked"}`,
  );
}

export async function cancelSalesOrderAction(id: string): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("operations.manage");
    await cancelSalesOrder(ctx, { id });
  });
  if (result.status !== "success") return result;
  revalidatePath("/orders");
  redirect(`/orders/${id}?notice=cancelled`);
}

export async function approveCreditAction(id: string): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("orders.overrideCreditLimit");
    await approveCreditOverride(ctx, { id });
  });
  if (result.status !== "success") return result;
  revalidatePath("/orders");
  redirect(`/orders/${id}?notice=approved`);
}
