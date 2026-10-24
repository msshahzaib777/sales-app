"use server";

import { redirect } from "next/navigation";
import { AuthError } from "next-auth";

import { signIn, signOut } from "@/auth";
import { type ActionState, echoValues } from "@/lib/action-state";
import { loginSchema } from "@/lib/validation/auth";

import { runAction } from "../actions";
import { changeOwnPassword } from "./account";
import { readSessionUser } from "./session";

// Sign-in, sign-out and password change return a result instead of redirecting; the form then
// does a full page load (`window.location.assign`). That throws away the browser's client-side
// page cache, so nothing cached for one session (pages, redirects) is shown to the next one, even
// on a shared office PC.

const LOGIN_FAILED = "Wrong email or password, or the account is not active.";

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = echoValues(formData);
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success)
    return { status: "error", message: "Enter your email and password.", values };
  try {
    await signIn("credentials", { ...parsed.data, redirect: false });
  } catch (error) {
    if (error instanceof AuthError) return { status: "error", message: LOGIN_FAILED, values };
    throw error;
  }
  return { status: "success" };
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirect: false });
}

/**
 * Changes the signed-in user's password. That ends all their sessions, including this one, so they
 * sign in again with the new password.
 */
export async function changePasswordAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await readSessionUser();
  if (!user) redirect("/login");
  const result = await runAction<undefined>(async () => {
    await changeOwnPassword(user.id, Object.fromEntries(formData));
  });
  if (result.status !== "success") return result;
  await signOut({ redirect: false });
  // The login page holds no user data, so a normal redirect is fine here.
  redirect("/login?passwordChanged=1");
}
