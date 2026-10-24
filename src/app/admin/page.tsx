import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LogoutButton } from "@/components/layout/logout-button";
import { requireUser } from "@/server/auth/session";

export const metadata: Metadata = { title: "Platform admin" };

export default function AdminPage() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
        <AdminPanel />
      </Suspense>
    </main>
  );
}

async function AdminPanel() {
  const user = await requireUser();
  if (user.role !== "SUPER_ADMIN") redirect("/dashboard");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Platform admin</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Signed in as {user.email}. The tenant and subscription panel arrives in Phase 5.
      </p>
      <div className="mt-6">
        <LogoutButton />
      </div>
    </>
  );
}
