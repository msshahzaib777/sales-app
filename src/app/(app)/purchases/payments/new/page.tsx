import type { Metadata } from "next";

import { BackLink, PageHeader } from "@/components/layout/page-header";
import { MoneyPage } from "@/components/purchasing/money-guard";
import { CompanyPaymentForm } from "@/components/purchasing/payment-form";
import { businessToday, toDateInput } from "@/lib/dates";
import { filterParam } from "@/lib/list-params";
import { requireTenantContext } from "@/server/auth/session";
import { saveCompanyPaymentAction } from "@/server/purchasing-actions";
import { openBillsByCompany } from "@/server/services/purchasing/payments";

export const metadata: Metadata = { title: "New company payment" };

export default function NewCompanyPaymentPage({
  searchParams,
}: PageProps<"/purchases/payments/new">) {
  return (
    <MoneyPage>
      <BackLink href="/purchases/payments">Company payments</BackLink>
      <PageHeader title="New company payment" />
      <Form searchParams={searchParams} />
    </MoneyPage>
  );
}

async function Form({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireTenantContext("payments.manage");
  const [companies, bills] = await Promise.all([
    ctx.db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    openBillsByCompany(ctx),
  ]);
  return (
    <CompanyPaymentForm
      action={saveCompanyPaymentAction}
      companies={companies}
      billsByCompany={bills}
      initialCompanyId={filterParam(sp, "companyId")}
      today={toDateInput(businessToday())}
    />
  );
}
