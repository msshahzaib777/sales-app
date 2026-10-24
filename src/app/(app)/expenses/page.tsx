import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { EmptyState, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Expenses" };

export default function ExpensesPage() {
  return (
    <RequirePermission permission="expenses.manage">
      <PageHeader title="Expenses" description="Daily expenses by category, bike and trip." />
      <EmptyState>Nothing here yet.</EmptyState>
    </RequirePermission>
  );
}
