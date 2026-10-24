import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, EmptyState, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { RecordForm } from "@/components/master/record-form";
import { requireTenantContext } from "@/server/auth/session";
import { saveRecordAction } from "@/server/master-actions";
import { warehouseOptions } from "@/server/services/master/warehouses";

import { areaFields } from "../../master-fields";

export const metadata: Metadata = { title: "New area" };

export default async function NewAreaPage({ searchParams }: PageProps<"/settings/areas/new">) {
  const { notice, last } = await searchParams;
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/settings/areas">Areas / routes</BackLink>
      <PageHeader title="New area" />
      <Notice notice={notice} />
      <Form key={String(last ?? "")} />
    </RequirePermission>
  );
}

async function Form() {
  const ctx = await requireTenantContext("masterData.manage");
  const warehouses = await warehouseOptions(ctx);
  if (warehouses.length === 0) return <EmptyState>Add a warehouse first.</EmptyState>;
  return (
    <RecordForm
      action={saveRecordAction.bind(null, "Area", null)}
      fields={areaFields({}, warehouses)}
      isNew
      cancelHref="/settings/areas"
    />
  );
}
