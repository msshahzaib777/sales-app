import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { RecordForm } from "@/components/master/record-form";
import { requireTenantContext } from "@/server/auth/session";
import { saveRecordAction } from "@/server/master-actions";
import { areaOptions } from "@/server/services/master/areas";
import { companyOptions } from "@/server/services/master/companies";

import { customerFields } from "../customer-fields";

export const metadata: Metadata = { title: "New customer" };

export default async function NewCustomerPage({ searchParams }: PageProps<"/customers/new">) {
  const { notice, last } = await searchParams;
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/customers">Customers</BackLink>
      <PageHeader title="New customer" />
      <Notice notice={notice} />
      <Form key={String(last ?? "")} />
    </RequirePermission>
  );
}

async function Form() {
  const ctx = await requireTenantContext("masterData.manage");
  const [areas, companies] = await Promise.all([areaOptions(ctx), companyOptions(ctx)]);
  return (
    <RecordForm
      action={saveRecordAction.bind(null, "Customer", null)}
      fields={customerFields({}, areas, companies)}
      isNew
      cancelHref="/customers"
    />
  );
}
