import type { Metadata } from "next";

import { EmptyState, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Purchases" };

export default function PurchasesPage() {
  return (
    <>
      <PageHeader
        title="Purchases"
        description="Purchase orders, goods receipts and company bills."
      />
      <EmptyState>Nothing here yet.</EmptyState>
    </>
  );
}
