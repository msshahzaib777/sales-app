import type { Metadata } from "next";

import { EmptyState, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage() {
  return (
    <>
      <PageHeader
        title="Customers"
        description="Retailers, wholesalers, dealers and bike suppliers."
      />
      <EmptyState>Nothing here yet.</EmptyState>
    </>
  );
}
