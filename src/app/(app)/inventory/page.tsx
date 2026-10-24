import type { Metadata } from "next";

import { EmptyState, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Inventory" };

export default function InventoryPage() {
  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock on hand, reserved and available per warehouse."
      />
      <EmptyState>Nothing here yet.</EmptyState>
    </>
  );
}
