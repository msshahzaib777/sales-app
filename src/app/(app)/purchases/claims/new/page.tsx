import type { Metadata } from "next";

import { BackLink, PageHeader } from "@/components/layout/page-header";
import { ClaimForm } from "@/components/purchasing/claim-form";
import { MoneyPage } from "@/components/purchasing/money-guard";
import { businessToday, toDateInput } from "@/lib/dates";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { saveClaimAction } from "@/server/purchasing-actions";
import { companyOptions } from "@/server/services/master/companies";
import { productsForPurchasing } from "@/server/services/purchasing/purchase-orders";

export const metadata: Metadata = { title: "Log claim" };

export default function NewClaimPage() {
  return (
    <MoneyPage>
      <BackLink href="/purchases/claims">Company claims</BackLink>
      <PageHeader title="Log claim" />
      <Form />
    </MoneyPage>
  );
}

async function Form() {
  const ctx = await requireTenantContext("payments.manage");
  const [companies, products] = await Promise.all([
    companyOptions(ctx),
    productsForPurchasing(ctx),
  ]);
  return (
    <ClaimForm
      action={saveClaimAction}
      companies={companies}
      products={products}
      today={toDateInput(businessToday())}
      showRate={can(ctx.user.role, "financials.view")}
    />
  );
}
