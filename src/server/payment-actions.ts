"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionState } from "@/lib/action-state";

import { runAction } from "./actions";
import { requireTenantContext } from "./auth/session";
import { ServiceError } from "./services/errors";
import {
  bounceCheque,
  clearCheque,
  clearCustomerFlag,
  createCustomerPayment,
  paymentContext,
  type PaymentContext,
  reverseCustomerPayment,
} from "./services/payments/customer-payments";

// Server actions for customer payments at the office. The services check permissions, allocate,
// post to the ledger and audit.

/** What the customer owes (per company, per bill) once they are picked on the payment screen. */
export async function paymentContextAction(
  customerId: string,
): Promise<PaymentContext | { error: string }> {
  try {
    const ctx = await requireTenantContext("payments.manage");
    return await paymentContext(ctx, customerId);
  } catch (error) {
    if (error instanceof ServiceError) return { error: error.message };
    throw error;
  }
}

export async function saveCustomerPaymentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let savedId = "";
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("payments.manage");
    const fields: Record<string, string> = {};
    for (const [key, value] of formData)
      if (typeof value === "string" && !key.startsWith("$ACTION")) fields[key] = value;
    const companyAmounts = Object.entries(fields)
      .filter(([key, value]) => key.startsWith("company:") && value.trim() !== "")
      .map(([key, amount]) => ({ companyId: key.slice("company:".length), amount }));
    savedId = (await createCustomerPayment(ctx, { ...fields, companyAmounts })).id;
  }, formData);
  if (result.status !== "success") return result;
  revalidatePath("/payments");
  revalidatePath("/customers");
  redirect(
    formData.get("intent") === "next"
      ? `/payments/new?notice=payment-posted`
      : `/payments/${savedId}?notice=payment-posted`,
  );
}

export async function clearChequeAction(id: string): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("payments.manage");
    await clearCheque(ctx, { id });
  });
  if (result.status !== "success") return result;
  revalidatePath("/payments");
  redirect(`/payments/${id}?notice=cheque-cleared`);
}

export async function bounceChequeAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("payments.manage");
    await bounceCheque(ctx, { id, reason: formData.get("reason") });
  }, formData);
  if (result.status !== "success") return result;
  revalidatePath("/payments");
  revalidatePath("/customers");
  redirect(`/payments/${id}?notice=cheque-bounced`);
}

export async function reverseCustomerPaymentAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("payments.manage");
    await reverseCustomerPayment(ctx, { id, reason: formData.get("reason") });
  }, formData);
  if (result.status !== "success") return result;
  revalidatePath("/payments");
  revalidatePath("/customers");
  redirect(`/payments/${id}?notice=payment-reversed`);
}

export async function clearCustomerFlagAction(customerId: string): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("payments.manage");
    await clearCustomerFlag(ctx, { id: customerId });
  });
  if (result.status !== "success") return result;
  revalidatePath("/customers");
  redirect(`/customers/${customerId}?notice=unflagged`);
}
