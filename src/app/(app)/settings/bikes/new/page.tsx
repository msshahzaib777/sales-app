import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { RecordForm } from "@/components/master/record-form";
import { requireTenantContext } from "@/server/auth/session";
import { saveRecordAction } from "@/server/master-actions";
import { driverOptions } from "@/server/services/master/staff";
import { warehouseOptions } from "@/server/services/master/warehouses";

import { bikeFields } from "../../master-fields";

export const metadata: Metadata = { title: "New bike" };

export default async function NewBikePage({ searchParams }: PageProps<"/settings/bikes/new">) {
  const { notice, last } = await searchParams;
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/settings/bikes">Delivery bikes</BackLink>
      <PageHeader title="New bike" />
      <Notice notice={notice} />
      <Form key={String(last ?? "")} />
    </RequirePermission>
  );
}

async function Form() {
  const ctx = await requireTenantContext("masterData.manage");
  const [warehouses, drivers] = await Promise.all([warehouseOptions(ctx), driverOptions(ctx)]);
  return (
    <RecordForm
      action={saveRecordAction.bind(null, "Bike", null)}
      fields={bikeFields({}, warehouses, drivers)}
      isNew
      cancelHref="/settings/bikes"
    />
  );
}
