"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { ActionState } from "@/lib/action-state";

import { runAction } from "./actions";
import { requireTenantContext } from "./auth/session";
import {
  createExpense,
  createExpenseCategory,
  reverseExpense,
  setExpenseCategoryActive,
} from "./services/expenses";

// Server actions for expenses. The services check permissions, validate and audit.

const fields = (formData: FormData) => {
  const out: Record<string, string> = {};
  for (const [key, value] of formData)
    if (typeof value === "string" && !key.startsWith("$ACTION")) out[key] = value;
  return out;
};

export async function saveExpenseAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("expenses.manage");
    await createExpense(ctx, fields(formData));
  }, formData);
  if (result.status !== "success") return result;
  revalidatePath("/expenses");
  redirect(
    formData.get("intent") === "next"
      ? "/expenses/new?notice=expense-saved"
      : "/expenses?notice=expense-saved",
  );
}

export async function reverseExpenseAction(
  id: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("expenses.manage");
    await reverseExpense(ctx, { id, reason: formData.get("reason") });
    return { message: "Expense reversed." };
  }, formData);
  if (result.status === "success") revalidatePath("/expenses");
  return result;
}

export async function addExpenseCategoryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("expenses.manage");
    const c = await createExpenseCategory(ctx, { name: formData.get("name") });
    return { message: `"${c.name}" added.` };
  }, formData);
  if (result.status === "success") revalidatePath("/expenses");
  return result;
}

export async function setExpenseCategoryActiveAction(
  id: string,
  active: boolean,
): Promise<ActionState> {
  const result = await runAction<undefined>(async () => {
    const ctx = await requireTenantContext("expenses.manage");
    await setExpenseCategoryActive(ctx, { id }, active);
    return { message: active ? "Switched on." : "Switched off." };
  });
  if (result.status === "success") revalidatePath("/expenses");
  return result;
}
