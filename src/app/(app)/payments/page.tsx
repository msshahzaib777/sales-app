import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { EmptyState, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Payments" };

export default function PaymentsPage() {
  return (
    <RequirePermission permission="payments.manage">
      <PageHeader title="Payments" description="Customer payments, cheques and allocations." />
      <EmptyState>Nothing here yet.</EmptyState>
    </RequirePermission>
  );
}
