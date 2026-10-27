import type { Metadata } from "next";

import { BackLink, PageHeader } from "@/components/layout/page-header";
import { MoneyPage } from "@/components/purchasing/money-guard";
import { SackReturnForm } from "@/components/purchasing/sack-return-form";
import { businessToday, toDateInput } from "@/lib/dates";
import { filterParam } from "@/lib/list-params";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { returnSacksAction } from "@/server/purchasing-actions";
import { sackReturnOptions } from "@/server/services/purchasing/claims";

export const metadata: Metadata = { title: "Return sacks" };

export default function ReturnSacksPage({ searchParams }: PageProps<"/purchases/claims/sacks">) {
  return (
    <MoneyPage>
      <BackLink href="/purchases/claims">Company claims</BackLink>
      <PageHeader
        title="Return sacks"
        description="Empty sacks sent back to a company. It credits its sack price for each, deducted on its next bill."
      />
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
  return (
    <SackReturnForm
      action={returnSacksAction}
      companies={await sackReturnOptions(ctx)}
      defaultCompanyId={filterParam(sp, "companyId")}
      today={toDateInput(businessToday())}
      showRate={can(ctx.user.role, "financials.view")}
    />
  );
}
