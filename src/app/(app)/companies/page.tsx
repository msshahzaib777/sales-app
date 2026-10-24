import type { Metadata } from "next";

import { EmptyState, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Companies" };

export default function CompaniesPage() {
  return (
    <>
      <PageHeader
        title="Companies"
        description="Supplier companies, order bookers and company ledgers."
      />
      <EmptyState>Nothing here yet.</EmptyState>
    </>
  );
}
