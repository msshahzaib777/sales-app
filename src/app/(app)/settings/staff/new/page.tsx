import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { RecordForm } from "@/components/master/record-form";
import { saveRecordAction } from "@/server/master-actions";

import { staffFields } from "../../master-fields";

export const metadata: Metadata = { title: "New staff member" };

export default async function NewStaffPage({ searchParams }: PageProps<"/settings/staff/new">) {
  const { notice, last } = await searchParams;
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/settings/staff">Staff</BackLink>
      <PageHeader title="New staff member" />
      <Notice notice={notice} />
      <RecordForm
        key={String(last ?? "")}
        action={saveRecordAction.bind(null, "Staff", null)}
        fields={staffFields({})}
        isNew
        cancelHref="/settings/staff"
      />
    </RequirePermission>
  );
}
