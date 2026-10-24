import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { orNotFound } from "@/components/master/page-helpers";
import { RecordForm } from "@/components/master/record-form";
import { RecordStatusActions } from "@/components/master/record-status-actions";
import { requireTenantContext } from "@/server/auth/session";
import { saveRecordAction } from "@/server/master-actions";
import { areaOptions } from "@/server/services/master/areas";
import { companyOptions } from "@/server/services/master/companies";
import { getCustomer } from "@/server/services/master/customers";

import { customerFields } from "../customer-fields";

export const metadata: Metadata = { title: "Edit customer" };

export default function EditCustomerPage({ params }: PageProps<"/customers/[id]">) {
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/customers">Customers</BackLink>
      <Editor params={params} />
    </RequirePermission>
  );
}

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenantContext("masterData.manage");
  const [customer, areas, companies] = await Promise.all([
    orNotFound(getCustomer(ctx, id)),
    areaOptions(ctx),
    companyOptions(ctx),
  ]);
  // Keep the current area selectable even if it was deactivated.
  const areaList =
    customer.areaId && customer.area && !areas.some((a) => a.id === customer.areaId)
      ? [
          ...areas,
          {
            id: customer.areaId,
            name: `${customer.area.name} (deactivated)`,
            warehouse: customer.area.warehouse,
          },
        ]
      : areas;
  return (
    <div className="space-y-8">
      <PageHeader title={customer.name} description={customer.shopName ?? undefined} />
      <RecordForm
        action={saveRecordAction.bind(null, "Customer", id)}
        fields={customerFields(
          { ...customer, creditLimit: customer.creditLimit?.toFixed(2) ?? null },
          areaList,
          companies,
        )}
        isNew={false}
        cancelHref="/customers"
      />
      <RecordStatusActions
        entity="Customer"
        id={id}
        label="this customer"
        isActive={customer.isActive}
      />
    </div>
  );
}
