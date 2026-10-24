import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { RecordForm } from "@/components/master/record-form";
import { saveRecordAction } from "@/server/master-actions";

import { warehouseFields } from "../../master-fields";

export const metadata: Metadata = { title: "New warehouse" };

export default async function NewWarehousePage({
  searchParams,
}: PageProps<"/settings/warehouses/new">) {
  const { notice, last } = await searchParams;
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/settings/warehouses">Warehouses</BackLink>
      <PageHeader title="New warehouse" />
      <Notice notice={notice} />
      <RecordForm
        key={String(last ?? "")}
        action={saveRecordAction.bind(null, "Warehouse", null)}
        fields={warehouseFields({})}
        isNew
        cancelHref="/settings/warehouses"
      />
    </RequirePermission>
  );
}
