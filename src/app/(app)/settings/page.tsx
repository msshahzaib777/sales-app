import type { Metadata } from "next";

import { EmptyState, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Tenant, users, printing and other settings." />
      <EmptyState>Nothing here yet.</EmptyState>
    </>
  );
}
