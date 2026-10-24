import type { Metadata } from "next";

import { Suspense } from "react";

import { LoginForm } from "./login-form";
import { PasswordChangedNotice } from "./password-changed-notice";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <div className="bg-card w-full max-w-sm rounded-lg border p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">Sales App</h1>
        <p className="text-muted-foreground mt-1 mb-6 text-sm">
          Sign in with your email and password.
        </p>
        <Suspense fallback={null}>
          <PasswordChangedNotice />
        </Suspense>
        <LoginForm />
      </div>
    </main>
  );
}
