import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, Td, Th } from "@/components/list/data-table";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { orNotFound } from "@/components/master/page-helpers";
import { DueDateForm } from "@/components/purchasing/due-date-form";
import { MoneyPage } from "@/components/purchasing/money-guard";
import { BillStatusBadge, PostingBadge } from "@/components/purchasing/status-badges";
import { formatDate, toDateInput } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import { updateDueDateAction } from "@/server/purchasing-actions";
import { getCompanyBill } from "@/server/services/purchasing/bills";

export const metadata: Metadata = { title: "Company bill" };

export default function CompanyBillPage({ params }: PageProps<"/purchases/bills/[id]">) {
  return (
    <MoneyPage>
      <BackLink href="/purchases/bills">Company bills</BackLink>
      <Bill params={params} />
    </MoneyPage>
  );
}

async function Bill({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenantContext("payments.manage");
  const bill = await orNotFound(getCompanyBill(ctx, id));
  return (
    <div className="space-y-6">
      <PageHeader
        title={
          bill.kind === "OPENING_BALANCE"
            ? `Opening balance (bill #${bill.number})`
            : `Company bill #${bill.number}`
        }
        description={`${bill.company.name} · billed ${formatDate(bill.billDate)} · due ${formatDate(bill.dueDate)}`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <BillStatusBadge state={bill.state} />
        <Link
          href={`/companies/${bill.companyId}/ledger`}
          className="text-sm underline underline-offset-4"
        >
          Company ledger
        </Link>
        {bill.goodsReceipt ? (
          <Link
            href={`/purchases/receipts/${bill.goodsReceipt.id}`}
            className="text-sm underline underline-offset-4"
          >
            Goods receipt #{bill.goodsReceipt.number}
          </Link>
        ) : null}
      </div>

      <DataTable>
        <thead>
          <tr>
            <Th>Product</Th>
            <Th className="text-right">Quantity</Th>
            <Th className="text-right">Rate / dz</Th>
            <Th className="text-right">Amount</Th>
          </tr>
        </thead>
        <tbody>
          {bill.kind === "OPENING_BALANCE" ? (
            <tr>
              <Td>Opening balance (owed before using the app)</Td>
              <Td />
              <Td />
              <Td className="text-right tabular-nums">{formatMoney(bill.grossAmount)}</Td>
            </tr>
          ) : null}
          {(bill.goodsReceipt?.lines ?? []).map((l) => (
            <tr key={l.id}>
              <Td>
                <span className="font-mono">{l.product.code}</span> {l.product.name}
              </Td>
              <Td className="text-right tabular-nums">{formatDozens(l.quantity)}</Td>
              <Td className="text-right tabular-nums">{formatMoney(l.rate)}</Td>
              <Td className="text-right tabular-nums">{formatMoney(l.amount)}</Td>
            </tr>
          ))}
          <tr>
            <Td>{bill.kind === "OPENING_BALANCE" ? "Total" : "Goods"}</Td>
            <Td />
            <Td />
            <Td className="text-right tabular-nums">{formatMoney(bill.grossAmount)}</Td>
          </tr>
          {bill.appliedClaims.map((c) => (
            <tr key={c.id}>
              <Td>
                Less claim #{c.number}: {c.product.name}
              </Td>
              <Td className="text-right tabular-nums">{formatDozens(c.quantity)}</Td>
              <Td />
              <Td className="text-right tabular-nums">−{formatMoney(c.amount)}</Td>
            </tr>
          ))}
          <tr className="font-medium">
            <Td>Bill total</Td>
            <Td />
            <Td />
            <Td className="text-right tabular-nums">{formatMoney(bill.netAmount)}</Td>
          </tr>
          <tr>
            <Td>Paid</Td>
            <Td />
            <Td />
            <Td className="text-right tabular-nums">{formatMoney(bill.state.paid)}</Td>
          </tr>
          <tr className="font-medium">
            <Td>Outstanding</Td>
            <Td />
            <Td />
            <Td className="text-right tabular-nums">{formatMoney(bill.state.outstanding)}</Td>
          </tr>
        </tbody>
      </DataTable>

      <section aria-labelledby="payments-heading">
        <h2 id="payments-heading" className="mb-2 font-medium">
          Payments
        </h2>
        {bill.allocations.length === 0 ? (
          <p className="text-muted-foreground text-sm">No payments yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {bill.allocations.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <Link
                  href={`/purchases/payments/${a.companyPayment.id}`}
                  className="underline underline-offset-4"
                >
                  Payment #{a.companyPayment.number}
                </Link>
                <span>{formatDate(a.companyPayment.paymentDate)}</span>
                <span className="tabular-nums">{formatMoney(a.amount)}</span>
                <PostingBadge status={a.companyPayment.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {bill.status === "POSTED" ? (
        <DueDateForm
          action={updateDueDateAction.bind(null, bill.id)}
          dueDate={toDateInput(bill.dueDate)}
        />
      ) : null}
    </div>
  );
}
