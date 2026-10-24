import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { orNotFound } from "@/components/master/page-helpers";
import { RecordForm } from "@/components/master/record-form";
import { RecordStatusActions } from "@/components/master/record-status-actions";
import { requireTenantContext } from "@/server/auth/session";
import { saveRecordAction } from "@/server/master-actions";
import { getCompany } from "@/server/services/master/companies";
import { warehouseOptions } from "@/server/services/master/warehouses";

import { companyFields } from "../company-fields";

export const metadata: Metadata = { title: "Edit company" };

export default function EditCompanyPage({ params }: PageProps<"/companies/[id]">) {
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/companies">Companies</BackLink>
      <Editor params={params} />
    </RequirePermission>
  );
}

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenantContext("masterData.manage");
  const [company, warehouses] = await Promise.all([
    orNotFound(getCompany(ctx, id)),
    warehouseOptions(ctx),
  ]);
  // Keep the current warehouse selectable even if it was deactivated.
  const options = warehouses.some((w) => w.id === company.warehouseId)
    ? warehouses
    : [...warehouses, { id: company.warehouseId, name: "(deactivated warehouse)" }];
  return (
    <div className="space-y-8">
      <PageHeader title={company.name} />
      <RecordForm
        action={saveRecordAction.bind(null, "Company", id)}
        fields={companyFields(company, options)}
        isNew={false}
        cancelHref="/companies"
      />
      <RecordStatusActions
        entity="Company"
        id={id}
        label="this company"
        isActive={company.isActive}
      />
    </div>
  );
}
