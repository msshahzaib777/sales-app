import type { Metadata } from "next";

import { EmptyState, PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return (
    <>
      <PageHeader title="Reports" description="Operational and financial reports." />
      <EmptyState>Nothing here yet.</EmptyState>
    </>
  );
}
