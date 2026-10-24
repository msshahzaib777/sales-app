import type { Metadata } from "next";

import { EmptyState, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Expenses" };

export default function ExpensesPage() {
  return (
    <>
      <PageHeader title="Expenses" description="Daily expenses by category, bike and trip." />
      <EmptyState>Nothing here yet.</EmptyState>
    </>
  );
}
