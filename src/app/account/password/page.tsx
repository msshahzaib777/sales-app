import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireUser } from "@/server/auth/session";

import { ChangePasswordForm } from "./change-password-form";

export const metadata: Metadata = { title: "Change password" };

export default function ChangePasswordPage() {
  return (
    <main className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <div className="bg-card w-full max-w-sm rounded-lg border p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">Change password</h1>
        <Suspense fallback={<p className="text-muted-foreground mt-4 text-sm">Loading…</p>}>
          <PasswordPanel />
        </Suspense>
      </div>
    </main>
  );
}

async function PasswordPanel() {
  const user = await requireUser();
  return (
    <>
      <p className="text-muted-foreground mt-1 mb-6 text-sm">
        {user.mustChangePassword
          ? "You signed in with a temporary password. Choose your own password to continue."
          : `Signed in as ${user.email}.`}
      </p>
      <ChangePasswordForm />
      {!user.mustChangePassword ? (
        <Link href="/dashboard" className="mt-4 inline-block text-sm underline underline-offset-4">
          Back to the app
        </Link>
      ) : null}
    </>
  );
}
