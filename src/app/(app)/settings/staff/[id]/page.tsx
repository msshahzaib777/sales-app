import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { orNotFound } from "@/components/master/page-helpers";
import { RecordForm } from "@/components/master/record-form";
import { RecordStatusActions } from "@/components/master/record-status-actions";
import { toDateInput } from "@/lib/dates";
import { requireTenantContext } from "@/server/auth/session";
import { saveRecordAction } from "@/server/master-actions";
import { bikeOptions, getStaff } from "@/server/services/master/staff";

import { staffFields } from "../../master-fields";

export const metadata: Metadata = { title: "Edit staff member" };

export default function EditStaffPage({ params }: PageProps<"/settings/staff/[id]">) {
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/settings/staff">Staff</BackLink>
      <Editor params={params} />
    </RequirePermission>
  );
}

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenantContext("masterData.manage");
  const [staff, bikes] = await Promise.all([orNotFound(getStaff(ctx, id)), bikeOptions(ctx)]);
  return (
    <div className="space-y-8">
      <PageHeader title={staff.name} />
      <RecordForm
        action={saveRecordAction.bind(null, "Staff", id)}
        fields={staffFields(
          {
            ...staff,
            monthlySalary: staff.monthlySalary.toFixed(2),
            joiningDate: staff.joiningDate ? toDateInput(staff.joiningDate) : null,
          },
          bikes,
        )}
        isNew={false}
        cancelHref="/settings/staff"
      />
      <RecordStatusActions
        entity="Staff"
        id={id}
        label="this staff member"
        isActive={staff.isActive}
      />
    </div>
  );
}
