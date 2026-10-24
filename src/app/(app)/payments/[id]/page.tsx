import type { Metadata } from "next";
import Link from "next/link";

import { ConfirmAction } from "@/components/form/confirm-action";
import { ReasonAction } from "@/components/form/reason-action";
import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { Notice } from "@/components/master/notice";
import { orNotFound } from "@/components/master/page-helpers";
import { METHOD_LABEL, PaymentBadges } from "@/components/payments/badges";
import { formatDate } from "@/lib/dates";
import { formatDateTime, formatMoney } from "@/lib/format";
import { requireTenantContext } from "@/server/auth/session";
import {
  bounceChequeAction,
  clearChequeAction,
  reverseCustomerPaymentAction,
} from "@/server/payment-actions";
import { getCustomerPayment } from "@/server/services/payments/customer-payments";

export const metadata: Metadata = { title: "Payment" };

export default function PaymentPage(props: PageProps<"/payments/[id]">) {
  return (
    <RequirePermission permission="payments.manage">
      <BackLink href="/payments">Payments</BackLink>
      <Payment {...props} />
    </RequirePermission>
  );
}

async function Payment({ params, searchParams }: PageProps<"/payments/[id]">) {
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  const ctx = await requireTenantContext("payments.manage");
  const p = await orNotFound(getCustomerPayment(ctx, id));
  const allocated = p.allocations.reduce((s, a) => s.add(a.amount), p.amount.sub(p.amount));
  const posted = p.status === "POSTED";
  const chequePending = posted && p.cheque?.status === "PENDING";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Payment #${p.number}`}
        description={`${p.customer.name}${p.customer.shopName ? ` · ${p.customer.shopName}` : ""} · ${formatDate(p.paymentDate)} · ${METHOD_LABEL[p.method]} · ${p.collectedVia === "DELIVERY" ? "collected at delivery" : "received at the office"}`}
      />
      <Notice notice={notice} />
      <div className="space-y-1 text-sm">
        <PaymentBadges status={p.status} chequeStatus={p.cheque?.status} />
        <p className="text-lg font-medium tabular-nums">PKR {formatMoney(p.amount)}</p>
        {p.cheque ? (
          <p>
            Cheque {p.cheque.chequeNo}, {p.cheque.bankName}, dated {formatDate(p.cheque.chequeDate)}
            {p.cheque.clearedAt ? ` · cleared ${formatDateTime(p.cheque.clearedAt)}` : ""}
            {p.cheque.bouncedAt ? ` · bounced ${formatDateTime(p.cheque.bouncedAt)}` : ""}
          </p>
        ) : null}
        {p.reference ? <p>Reference: {p.reference}</p> : null}
        {p.note ? <p>{p.note}</p> : null}
        {p.salesOrder ? (
          <p>
            Collected on{" "}
            <Link href={`/orders/${p.salesOrder.id}`} className="underline underline-offset-4">
              order #{p.salesOrder.number}
            </Link>
          </p>
        ) : null}
        {p.status === "REVERSED" ? <p>Reversed: {p.reversalReason}</p> : null}
        <Link
          href={`/customers/${p.customer.id}/statement`}
          className="underline underline-offset-4"
        >
          Customer statement
        </Link>
      </div>

      <section aria-labelledby="split-heading" className="max-w-md">
        <h2 id="split-heading" className="mb-2 font-medium">
          Credited per company
        </h2>
        <ul className="space-y-1 text-sm">
          {p.shares.map((s) => (
            <li key={s.companyId} className="flex justify-between gap-4">
              <span>{s.companyName}</span>
              <span className="tabular-nums">{formatMoney(s.amount)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="bills-heading">
        <h2 id="bills-heading" className="mb-2 font-medium">
          Applied to bills
        </h2>
        <DataTable>
          <thead>
            <tr>
              <Th>Bill</Th>
              <Th>Date</Th>
              <Th>Company</Th>
              <Th className="text-right">Applied</Th>
            </tr>
          </thead>
          <tbody>
            {p.allocations.length === 0 ? (
              <EmptyRow colSpan={4}>Not applied to a bill (opening balance or advance).</EmptyRow>
            ) : null}
            {p.allocations.map((a) => (
              <tr key={a.id}>
                <Td>
                  <Link
                    href={`/orders/${a.bill.salesOrderId}/bill`}
                    className="underline-offset-4 hover:underline"
                  >
                    #{a.bill.number}
                  </Link>
                </Td>
                <Td>{formatDate(a.bill.billDate)}</Td>
                <Td>{a.company.name}</Td>
                <Td className="text-right tabular-nums">{formatMoney(a.amount)}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        {p.amount.gt(allocated) ? (
          <p className="mt-2 text-sm">
            Opening balance or advance (not on a bill): {formatMoney(p.amount.sub(allocated))}
          </p>
        ) : null}
      </section>

      {chequePending ? (
        <div className="flex flex-wrap items-start gap-3">
          <ConfirmAction
            action={clearChequeAction.bind(null, p.id)}
            label="Cheque cleared"
            confirm={`Mark cheque ${p.cheque!.chequeNo} as cleared by the bank?`}
          />
          <ReasonAction
            action={bounceChequeAction.bind(null, p.id)}
            label="Cheque bounced"
            description="The payment is reversed, the customer owes the amount again, and the customer is flagged."
          />
        </div>
      ) : null}
      {posted && p.cheque?.status !== "CLEARED" ? (
        <ReasonAction
          action={reverseCustomerPaymentAction.bind(null, p.id)}
          label="Reverse payment"
          description="For a payment entered by mistake. The customer owes the amount again."
        />
      ) : null}
    </div>
  );
}
