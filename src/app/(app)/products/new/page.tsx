import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, EmptyState, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { RecordForm } from "@/components/master/record-form";
import { businessToday, toDateInput } from "@/lib/dates";
import { requireTenantContext } from "@/server/auth/session";
import { saveRecordAction } from "@/server/master-actions";
import { companyOptions } from "@/server/services/master/companies";

import { productFields } from "../product-fields";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage({ searchParams }: PageProps<"/products/new">) {
  const { notice, last } = await searchParams;
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/products">Products</BackLink>
      <PageHeader title="New product" />
      <Notice notice={notice} />
      <Form key={String(last ?? "")} />
    </RequirePermission>
  );
}

async function Form() {
  const ctx = await requireTenantContext("masterData.manage");
  const companies = await companyOptions(ctx);
  if (companies.length === 0) return <EmptyState>Add a company first.</EmptyState>;
  return (
    <RecordForm
      action={saveRecordAction.bind(null, "Product", null)}
      fields={productFields({}, companies, toDateInput(businessToday()))}
      isNew
      cancelHref="/products"
    />
  );
}
