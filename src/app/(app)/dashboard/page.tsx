import type { Metadata } from "next";

import { EmptyState, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Today's sales, collections, pending balances and low stock."
      />
      <EmptyState>Nothing here yet.</EmptyState>
    </>
  );
}
