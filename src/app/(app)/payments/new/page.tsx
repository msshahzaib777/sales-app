import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { CustomerPaymentForm } from "@/components/payments/payment-form";
import { businessToday, toDateInput } from "@/lib/dates";
import { filterParam } from "@/lib/list-params";
import { requireTenantContext } from "@/server/auth/session";
import { paymentContextAction, saveCustomerPaymentAction } from "@/server/payment-actions";
import { customersForOrders } from "@/server/services/sales/orders";

export const metadata: Metadata = { title: "Receive payment" };

export default function NewPaymentPage({ searchParams }: PageProps<"/payments/new">) {
  return (
    <RequirePermission permission="payments.manage">
      <BackLink href="/payments">Payments</BackLink>
      <PageHeader
        title="Receive payment"
        description="Cash, cheque or online transfer received at the office."
      />
      <Form searchParams={searchParams} />
    </RequirePermission>
  );
}

async function Form({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireTenantContext("payments.manage");
  const customers = await customersForOrders(ctx);
  const customerId = filterParam(sp, "customerId");
  return (
    <>
      <Notice notice={sp.notice} />
      <CustomerPaymentForm
        key={customerId ?? "new"}
        action={saveCustomerPaymentAction}
        loadContext={paymentContextAction}
        customers={customers}
        initialCustomerId={customerId}
        today={toDateInput(businessToday())}
      />
    </>
  );
}
