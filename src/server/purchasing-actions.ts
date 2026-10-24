"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { type ActionState, echoValues } from "@/lib/action-state";
import { purchaseLineSchema } from "@/lib/validation/purchasing";

import { runAction } from "./actions";
import { requireTenantContext } from "./auth/session";
import { updateBillDueDate } from "./services/purchasing/bills";
import { cancelClaim, settleClaim, createClaim } from "./services/purchasing/claims";
import { cancelGoodsReceipt, createGoodsReceipt } from "./services/purchasing/goods-receipts";
import { createCompanyPayment, reverseCompanyPayment } from "./services/purchasing/payments";
import {
  createPurchaseOrder,
  setPurchaseOrderStatus,
  updatePurchaseOrder,
} from "./services/purchasing/purchase-orders";

// Server actions for purchasing. Each re-checks the session; the services check permissions,
// validate, post to the journals and write the audit log.

function fields(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of formData) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) out[key] = value;
  }
  return out;
}

/**
 * Product rows arrive as parallel arrays (productId[], quantity[], rate[]). Rows without a quantity
 * are skipped. Each row is checked here so errors point at the product's own inputs.
 */
function productLines(formData: FormData) {
  const ids = formData.getAll("productId").map(String);
  const quantities = formData.getAll("quantity").map(String);
  const rates = formData.getAll("rate").map(String);
  const lines: { productId: string; quantity: string; rate: string }[] = [];
  const fieldErrors: Record<string, string[]> = {};
  ids.forEach((productId, i) => {
    const quantity = (quantities[i] ?? "").trim();
    if (quantity === "" || Number(quantity) === 0) return;
    const line = { productId, quantity, rate: rates[i] ?? "" };
    const parsed = purchaseLineSchema.safeParse(line);
    if (!parsed.success) {
      for (const issue of parsed.error.issues)
        (fieldErrors[`${String(issue.path[0])}.${productId}`] ??= []).push(issue.message);
    }
    lines.push(line);
  });
  return { lines, fieldErrors };
}

function lineErrorState(formData: FormData, fieldErrors: Record<string, string[]>): ActionState {
  return {
    status: "error",
    message: "Please check the highlighted quantities.",
    fieldErrors,
    values: echoValues(formData),
  };
}

// ───────────────────────── Purchase orders ─────────────────────────

export async function savePurchaseOrderAction(
  id: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { lines, fieldErrors } = productLines(formData);
  if (Object.keys(fieldErrors).length > 0) return lineErrorState(formData, fieldErrors);
  let savedId = id ?? "";
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("operations.manage");
    const input = { ...fields(formData), lines };
    const saved = id
      ? await updatePurchaseOrder(ctx, id, input)
      : await createPurchaseOrder(ctx, input);
    savedId = saved.id;
  }, formData);
  if (result.status !== "success") return result;
  revalidatePath("/purchases");
  redirect(`/purchases/orders/${savedId}?notice=saved`);
}

export async function purchaseOrderStatusAction(
  id: string,
  target: "CANCELLED" | "CLOSED",
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("operations.manage");
    await setPurchaseOrderStatus(ctx, { id }, target);
    return {
      message: target === "CANCELLED" ? "Purchase order cancelled." : "Purchase order closed.",
    };
  });
  if (result.status === "success") revalidatePath(`/purchases/orders/${id}`);
  return result;
}

// ───────────────────────── Goods receipts ─────────────────────────

export async function saveGoodsReceiptAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { lines, fieldErrors } = productLines(formData);
  if (Object.keys(fieldErrors).length > 0) return lineErrorState(formData, fieldErrors);
  let savedId = "";
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("operations.manage");
    const receipt = await createGoodsReceipt(ctx, { ...fields(formData), lines });
    savedId = receipt.id;
  }, formData);
  if (result.status !== "success") return result;
  revalidatePath("/purchases");
  redirect(`/purchases/receipts/${savedId}?notice=posted`);
}

export async function cancelGoodsReceiptAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("documents.reverse");
    await cancelGoodsReceipt(ctx, { id, reason: formData.get("reason") });
    return { message: "Receipt cancelled. Its stock and bill were reversed." };
  }, formData);
  if (result.status === "success") revalidatePath(`/purchases/receipts/${id}`);
  return result;
}

// ───────────────────────── Bills, payments, claims ─────────────────────────

export async function updateDueDateAction(
  billId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("payments.manage");
    await updateBillDueDate(ctx, { billId, dueDate: formData.get("dueDate") });
    return { message: "Due date updated." };
  }, formData);
  if (result.status === "success") revalidatePath(`/purchases/bills/${billId}`);
  return result;
}

export async function saveCompanyPaymentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let savedId = "";
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("payments.manage");
    const all = fields(formData);
    const allocations = Object.entries(all)
      .filter(
        ([key, value]) =>
          key.startsWith("alloc:") && value.trim() !== "" && Number(value.replace(/,/g, "")) !== 0,
      )
      .map(([key, amount]) => ({ billId: key.slice("alloc:".length), amount }));
    const payment = await createCompanyPayment(ctx, { ...all, allocations });
    savedId = payment.id;
  }, formData);
  if (result.status !== "success") return result;
  revalidatePath("/purchases");
  redirect(`/purchases/payments/${savedId}?notice=posted`);
}

export async function reverseCompanyPaymentAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("payments.manage");
    await reverseCompanyPayment(ctx, { id, reason: formData.get("reason") });
    return { message: "Payment reversed. Its bills are open again." };
  }, formData);
  if (result.status === "success") revalidatePath(`/purchases/payments/${id}`);
  return result;
}

export async function saveClaimAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("payments.manage");
    await createClaim(ctx, fields(formData));
  }, formData);
  if (result.status !== "success") return result;
  revalidatePath("/purchases/claims");
  redirect("/purchases/claims?notice=posted");
}

export async function cancelClaimAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("payments.manage");
    await cancelClaim(ctx, { id, reason: formData.get("reason") });
    return { message: "Claim cancelled." };
  }, formData);
  if (result.status === "success") revalidatePath("/purchases/claims");
  return result;
}

export async function settleClaimAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("payments.manage");
    const claim = await settleClaim(ctx, {
      id,
      decision: formData.get("decision"),
      amount: formData.get("amount"),
      note: formData.get("note"),
    });
    return {
      message:
        claim.status === "REJECTED"
          ? "Claim rejected. No money moved."
          : `Claim accepted for ${claim.amount.toFixed(2)}; it is deducted on the company's next bill.`,
    };
  }, formData);
  if (result.status === "success") revalidatePath("/purchases/claims");
  return result;
}
