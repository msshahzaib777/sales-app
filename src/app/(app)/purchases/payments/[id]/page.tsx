import type { Metadata } from "next";
import Link from "next/link";

import { ReasonAction } from "@/components/form/reason-action";
import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { orNotFound } from "@/components/master/page-helpers";
import { MoneyPage } from "@/components/purchasing/money-guard";
import { PostingBadge } from "@/components/purchasing/status-badges";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { requireTenantContext } from "@/server/auth/session";
import { reverseCompanyPaymentAction } from "@/server/purchasing-actions";
import { getCompanyPayment } from "@/server/services/purchasing/payments";

export const metadata: Metadata = { title: "Company payment" };

const METHOD = { CASH: "Cash", CHEQUE: "Cheque", ONLINE: "Online transfer" } as const;

export default function CompanyPaymentPage({
  params,
  searchParams,
}: PageProps<"/purchases/payments/[id]">) {
  return (
    <MoneyPage>
      <BackLink href="/purchases/payments">Company payments</BackLink>
      <Payment params={params} searchParams={searchParams} />
    </MoneyPage>
  );
}

async function Payment({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  const ctx = await requireTenantContext("payments.manage");
  const p = await orNotFound(getCompanyPayment(ctx, id));
  const allocated = p.allocations.reduce((s, a) => s.add(a.amount), p.amount.sub(p.amount));
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Payment #${p.number}`}
        description={`${p.company.name} · ${formatDate(p.paymentDate)} · ${METHOD[p.method]}`}
      />
      <Notice notice={notice} />
      <div className="space-y-1 text-sm">
        <PostingBadge status={p.status} />
        <p className="text-lg font-medium tabular-nums">PKR {formatMoney(p.amount)}</p>
        {p.cheque ? (
          <p>
            Cheque {p.cheque.chequeNo}, {p.cheque.bankName}, dated {formatDate(p.cheque.chequeDate)}
          </p>
        ) : null}
        {p.reference ? <p>Reference: {p.reference}</p> : null}
        {p.note ? <p>{p.note}</p> : null}
        {p.status === "REVERSED" ? <p>Reversed: {p.reversalReason}</p> : null}
        <Link href={`/companies/${p.companyId}/ledger`} className="underline underline-offset-4">
          Company ledger
        </Link>
      </div>
      <DataTable>
        <thead>
          <tr>
            <Th>Bill</Th>
            <Th>Billed</Th>
            <Th>Due</Th>
            <Th className="text-right">Applied</Th>
          </tr>
        </thead>
        <tbody>
          {p.allocations.length === 0 ? (
            <EmptyRow colSpan={4}>Not applied to any bill (advance).</EmptyRow>
          ) : null}
          {p.allocations.map((a) => (
            <tr key={a.id}>
              <Td>
                <Link
                  href={`/purchases/bills/${a.companyBill.id}`}
                  className="underline-offset-4 hover:underline"
                >
                  #{a.companyBill.number}
                </Link>
              </Td>
              <Td>{formatDate(a.companyBill.billDate)}</Td>
              <Td>{formatDate(a.companyBill.dueDate)}</Td>
              <Td className="text-right tabular-nums">{formatMoney(a.amount)}</Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      {p.amount.gt(allocated) ? (
        <p className="text-sm">
          Advance (not applied to a bill): {formatMoney(p.amount.sub(allocated))}
        </p>
      ) : null}
      {p.status === "POSTED" ? (
        <ReasonAction
          action={reverseCompanyPaymentAction.bind(null, p.id)}
          label="Reverse payment"
          description="Use this for a payment entered by mistake or a cheque that bounced. Its bills become unpaid again."
        />
      ) : null}
    </div>
  );
}
