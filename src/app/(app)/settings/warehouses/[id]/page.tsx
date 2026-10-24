import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { orNotFound } from "@/components/master/page-helpers";
import { RecordForm } from "@/components/master/record-form";
import { RecordStatusActions } from "@/components/master/record-status-actions";
import { requireTenantContext } from "@/server/auth/session";
import { saveRecordAction } from "@/server/master-actions";
import { getWarehouse } from "@/server/services/master/warehouses";

import { warehouseFields } from "../../master-fields";

export const metadata: Metadata = { title: "Edit warehouse" };

export default function EditWarehousePage({ params }: PageProps<"/settings/warehouses/[id]">) {
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/settings/warehouses">Warehouses</BackLink>
      <Editor params={params} />
    </RequirePermission>
  );
}

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenantContext("masterData.manage");
  const warehouse = await orNotFound(getWarehouse(ctx, id));
  return (
    <div className="space-y-8">
      <PageHeader title={warehouse.name} />
      <RecordForm
        action={saveRecordAction.bind(null, "Warehouse", id)}
        fields={warehouseFields(warehouse)}
        isNew={false}
        cancelHref="/settings/warehouses"
      />
      <RecordStatusActions
        entity="Warehouse"
        id={id}
        label="this warehouse"
        isActive={warehouse.isActive}
      />
    </div>
  );
}
