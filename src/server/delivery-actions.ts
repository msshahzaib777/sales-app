"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionState } from "@/lib/action-state";

import { runAction } from "./actions";
import { requireTenantContext } from "./auth/session";
import { nextOrderToReconcile, saveDayEnd } from "./services/delivery/day-end";
import {
  addOrdersToTrip,
  cancelTrip,
  createTrip,
  dispatchTrip,
  removeOrderFromTrip,
} from "./services/delivery/trips";

// Server actions for delivery trips and day-end entry. The services check permissions, validate,
// post to the journals and audit.

/** Plain fields, with every ticked `orderIds` box kept as a list. */
function tripInput(formData: FormData) {
  const fields: Record<string, unknown> = {};
  for (const [key, value] of formData)
    if (typeof value === "string" && !key.startsWith("$ACTION") && key !== "orderIds")
      fields[key] = value;
  return { ...fields, orderIds: formData.getAll("orderIds").map(String) };
}

export async function createTripAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let id = "";
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("operations.manage");
    id = (await createTrip(ctx, tripInput(formData))).id;
  }, formData);
  if (result.status !== "success") return result;
  revalidatePath("/delivery");
  redirect(`/delivery/${id}?notice=trip-planned`);
}

export async function addOrdersToTripAction(
  tripId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("operations.manage");
    await addOrdersToTrip(ctx, { ...tripInput(formData), tripId });
  });
  if (result.status !== "success") return result;
  revalidatePath("/delivery");
  redirect(`/delivery/${tripId}?notice=saved`);
}

export async function removeOrderFromTripAction(
  tripId: string,
  orderId: string,
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("operations.manage");
    await removeOrderFromTrip(ctx, { tripId, orderId });
  });
  if (result.status !== "success") return result;
  revalidatePath("/delivery");
  redirect(`/delivery/${tripId}?notice=removed`);
}

export async function cancelTripAction(id: string): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("operations.manage");
    await cancelTrip(ctx, { id });
  });
  if (result.status !== "success") return result;
  revalidatePath("/delivery");
  redirect(`/delivery/${id}?notice=trip-cancelled`);
}

export async function dispatchTripAction(id: string): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("operations.manage");
    await dispatchTrip(ctx, { id });
  });
  if (result.status !== "success") return result;
  revalidatePath("/delivery");
  revalidatePath("/orders");
  redirect(`/delivery/${id}?notice=dispatched`);
}

/** Saves one order's day-end entry, then opens the trip's next order still to enter. */
export async function saveDayEndAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let tripId = "";
  let next: string | null = null;
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("operations.manage");
    const fields: Record<string, string> = {};
    for (const [key, value] of formData)
      if (typeof value === "string" && !key.startsWith("$ACTION") && !key.startsWith("line."))
        fields[key] = value;
    const productIds = formData.getAll("line.productId").map(String);
    const returned = formData.getAll("line.returned").map(String);
    const damaged = formData.getAll("line.damaged").map(String);
    const saved = await saveDayEnd(ctx, {
      ...fields,
      lines: productIds.map((productId, i) => ({
        productId,
        returned: returned[i] ?? "",
        damaged: damaged[i] ?? "",
      })),
    });
    tripId = saved.tripId ?? "";
    next = await nextOrderToReconcile(ctx, tripId);
  }, formData);
  if (result.status !== "success") return result;
  revalidatePath("/delivery");
  revalidatePath("/orders");
  redirect(
    next
      ? `/delivery/${tripId}/day-end/${next}?notice=day-end-saved`
      : `/delivery/${tripId}?notice=day-end-saved`,
  );
}
