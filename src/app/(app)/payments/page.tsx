import type { Metadata } from "next";

import { EmptyState, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Payments" };

export default function PaymentsPage() {
  return (
    <>
      <PageHeader title="Payments" description="Customer payments, cheques and allocations." />
      <EmptyState>Nothing here yet.</EmptyState>
    </>
  );
}
