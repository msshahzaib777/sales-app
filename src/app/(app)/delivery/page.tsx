import type { Metadata } from "next";

import { EmptyState, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Delivery" };

export default function DeliveryPage() {
  return (
    <>
      <PageHeader
        title="Delivery"
        description="Dispatch orders to bikes and enter day-end results."
      />
      <EmptyState>Nothing here yet.</EmptyState>
    </>
  );
}
