import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { orNotFound } from "@/components/master/page-helpers";
import { RecordForm } from "@/components/master/record-form";
import { RecordStatusActions } from "@/components/master/record-status-actions";
import { requireTenantContext } from "@/server/auth/session";
import { saveRecordAction } from "@/server/master-actions";
import { getBike } from "@/server/services/master/bikes";
import { driverOptions } from "@/server/services/master/staff";
import { warehouseOptions } from "@/server/services/master/warehouses";

import { bikeFields } from "../../master-fields";

export const metadata: Metadata = { title: "Edit bike" };

export default function EditBikePage({ params }: PageProps<"/settings/bikes/[id]">) {
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/settings/bikes">Delivery bikes</BackLink>
      <Editor params={params} />
    </RequirePermission>
  );
}

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenantContext("masterData.manage");
  const [bike, warehouses, drivers] = await Promise.all([
    orNotFound(getBike(ctx, id)),
    warehouseOptions(ctx),
    driverOptions(ctx),
  ]);
  return (
    <div className="space-y-8">
      <PageHeader title={bike.name} />
      <RecordForm
        action={saveRecordAction.bind(null, "Bike", id)}
        fields={bikeFields(bike, warehouses, drivers)}
        isNew={false}
        cancelHref="/settings/bikes"
      />
      <RecordStatusActions entity="Bike" id={id} label="this bike" isActive={bike.isActive} />
    </div>
  );
}
