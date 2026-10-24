import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { RecordForm } from "@/components/master/record-form";
import { requireTenantContext } from "@/server/auth/session";
import { saveRecordAction } from "@/server/master-actions";
import { bikeOptions } from "@/server/services/master/staff";

import { staffFields } from "../../master-fields";

export const metadata: Metadata = { title: "New staff member" };

export default async function NewStaffPage({ searchParams }: PageProps<"/settings/staff/new">) {
  const { notice, last } = await searchParams;
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/settings/staff">Staff</BackLink>
      <PageHeader title="New staff member" />
      <Notice notice={notice} />
      <Form last={String(last ?? "")} />
    </RequirePermission>
  );
}

async function Form({ last }: { last: string }) {
  const ctx = await requireTenantContext("masterData.manage");
  const bikes = await bikeOptions(ctx);
  return (
    <RecordForm
      key={last}
      action={saveRecordAction.bind(null, "Staff", null)}
      fields={staffFields({}, bikes)}
      isNew
      cancelHref="/settings/staff"
    />
  );
}
