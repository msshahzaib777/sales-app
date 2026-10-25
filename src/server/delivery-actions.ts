"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ZodError } from "zod";

import { type ActionState, echoValues } from "@/lib/action-state";

import { isWriteConflict, runAction } from "./actions";
import { ForbiddenError } from "./auth/permissions";
import { requireTenantContext } from "./auth/session";
import { ServiceError } from "./services/errors";
import { nextOrderToReconcile, saveDayEnd, undoDayEnd } from "./services/delivery/day-end";
import {
  addOrdersToTrip,
  cancelTrip,
  createTrip,
  dispatchTrip,
  removeOrderFromTrip,
  setTripDriver,
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

/**
 * The whole trip's day-end from one page. Fields are named `o:<orderId>:<field>`. Each order is
 * saved on its own (its own transaction and request id), so one order with a mistake does not hold
 * back the others; pressing Save again never posts an order twice. Errors come back keyed
 * `o:<orderId>:<field>`, with a list of the orders that were not saved.
 */
export async function saveTripDayEndAction(
  tripId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = echoValues(formData);
  let ctx;
  try {
    ctx = await requireTenantContext("operations.manage");
  } catch (error) {
    if (error instanceof ForbiddenError)
      return { status: "error", message: "You do not have permission to do this." };
    throw error;
  }
  const orderIds = formData.getAll("orderId").map(String);
  const get = (id: string, field: string) => {
    const v = formData.get(`o:${id}:${field}`);
    return typeof v === "string" ? v : "";
  };
  const fieldErrors: Record<string, string[]> = {};
  const failed: string[] = [];
  let saved = 0;
  for (const id of orderIds) {
    const label = get(id, "label") || id;
    const productIds = formData.getAll(`o:${id}:line.productId`).map(String);
    const returned = formData.getAll(`o:${id}:line.returned`).map(String);
    const damaged = formData.getAll(`o:${id}:line.damaged`).map(String);
    try {
      await saveDayEnd(ctx, {
        requestId: get(id, "requestId"),
        orderId: id,
        lines: productIds.map((productId, i) => ({
          productId,
          returned: returned[i] ?? "",
          damaged: damaged[i] ?? "",
        })),
        cash: get(id, "cash"),
        chequeAmount: get(id, "chequeAmount"),
        chequeNo: get(id, "chequeNo"),
        bankName: get(id, "bankName"),
        chequeDate: get(id, "chequeDate"),
        onlineAmount: get(id, "onlineAmount"),
        onlineReference: get(id, "onlineReference"),
        note: get(id, "note"),
      });
      saved++;
    } catch (error) {
      if (error instanceof ZodError) {
        for (const issue of error.issues)
          (fieldErrors[`o:${id}:${issue.path.join(".") || "form"}`] ??= []).push(issue.message);
        failed.push(`${label}: check the highlighted boxes`);
      } else if (error instanceof ServiceError) {
        (fieldErrors[`o:${id}:form`] ??= []).push(error.message);
        failed.push(`${label}: ${error.message}`);
      } else if (isWriteConflict(error)) {
        failed.push(`${label}: someone saved at the same moment; press Save again`);
      } else {
        throw error;
      }
    }
  }
  revalidatePath("/delivery");
  revalidatePath("/orders");
  if (failed.length > 0) {
    return {
      status: "error",
      message: `${saved ? `${saved} saved. ` : ""}Not saved: ${failed.join(" · ")}`,
      fieldErrors,
      values,
    };
  }
  redirect(`/delivery/${tripId}?notice=day-end-saved`);
}
/** Undoes a saved day-end (by reversal) and opens the order's day-end form again. */
export async function undoDayEndAction(
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let tripId = "";
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("payments.manage");
    tripId = (await undoDayEnd(ctx, { id: orderId, reason: formData.get("reason") })).tripId;
  }, formData);
  if (result.status !== "success") return result;
  revalidatePath("/delivery");
  revalidatePath("/orders");
  revalidatePath("/payments");
  redirect(`/delivery/${tripId}/day-end/${orderId}?notice=day-end-undone`);
}

export async function setTripDriverAction(
  tripId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("operations.manage");
    await setTripDriver(ctx, { tripId, driverId: formData.get("driverId") });
    return { message: "Driver saved." };
  }, formData);
  if (result.status === "success") revalidatePath(`/delivery/${tripId}`);
  return result;
}
