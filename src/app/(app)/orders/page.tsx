import type { Metadata } from "next";

import { EmptyState, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Orders" };

export default function OrdersPage() {
  return (
    <>
      <PageHeader title="Orders" description="Book and manage customer sales orders." />
      <EmptyState>Nothing here yet.</EmptyState>
    </>
  );
}
