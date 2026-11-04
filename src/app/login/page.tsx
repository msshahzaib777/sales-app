import type { Metadata } from "next";

import Image from "next/image";
import { Suspense } from "react";

import { APP_NAME, APP_NAME_URDU, TAGLINE } from "@/lib/brand";

import { LoginForm } from "./login-form";
import { PasswordChangedNotice } from "./password-changed-notice";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <div className="bg-card w-full max-w-sm rounded-lg border p-6 shadow-sm">
        {/* unoptimized: served as it is, so the installed copy needs no image tools. */}
        <Image
          src="/brand/taqseem-logo.png"
          alt=""
          width={480}
          height={422}
          priority
          unoptimized
          className="mx-auto mb-4 h-auto w-40"
        />
        <h1 className="flex items-baseline justify-between gap-3 text-xl font-semibold tracking-tight">
          {APP_NAME}
          <span lang="ur" dir="rtl" className="text-muted-foreground text-lg font-normal">
            {APP_NAME_URDU}
          </span>
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{TAGLINE}</p>
        <p className="text-muted-foreground mt-4 mb-6 text-sm">
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
