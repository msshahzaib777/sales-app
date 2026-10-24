import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { orNotFound } from "@/components/master/page-helpers";
import { RecordForm } from "@/components/master/record-form";
import { RecordStatusActions } from "@/components/master/record-status-actions";
import { requireTenantContext } from "@/server/auth/session";
import { saveRecordAction } from "@/server/master-actions";
import { getArea } from "@/server/services/master/areas";
import { warehouseOptions } from "@/server/services/master/warehouses";

import { areaFields } from "../../master-fields";

export const metadata: Metadata = { title: "Edit area" };

export default function EditAreaPage({ params }: PageProps<"/settings/areas/[id]">) {
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/settings/areas">Areas / routes</BackLink>
      <Editor params={params} />
    </RequirePermission>
  );
}

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenantContext("masterData.manage");
  const [area, warehouses] = await Promise.all([
    orNotFound(getArea(ctx, id)),
    warehouseOptions(ctx),
  ]);
  const options = warehouses.some((w) => w.id === area.warehouseId)
    ? warehouses
    : [...warehouses, { id: area.warehouseId, name: "(deactivated warehouse)" }];
  return (
    <div className="space-y-8">
      <PageHeader title={area.name} />
      <RecordForm
        action={saveRecordAction.bind(null, "Area", id)}
        fields={areaFields(area, options)}
        isNew={false}
        cancelHref="/settings/areas"
      />
      <RecordStatusActions entity="Area" id={id} label="this area" isActive={area.isActive} />
    </div>
  );
}
