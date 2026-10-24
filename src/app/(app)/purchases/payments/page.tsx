import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { LinkButton } from "@/components/master/page-helpers";
import { MoneyPage } from "@/components/purchasing/money-guard";
import { PostingBadge } from "@/components/purchasing/status-badges";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { filterParam, listParamsSchema } from "@/lib/list-params";
import { requireTenantContext } from "@/server/auth/session";
import { companyOptions } from "@/server/services/master/companies";
import { parseDateRange } from "@/server/services/purchasing/filters";
import { listCompanyPayments } from "@/server/services/purchasing/payments";

export const metadata: Metadata = { title: "Company payments" };

const METHOD = { CASH: "Cash", CHEQUE: "Cheque", ONLINE: "Online" } as const;

export default function CompanyPaymentsPage({ searchParams }: PageProps<"/purchases/payments">) {
  return (
    <MoneyPage>
      <PageHeader
        title="Company payments"
        description="Payments to companies. One payment can settle several bills."
        actions={<LinkButton href="/purchases/payments/new">New payment</LinkButton>}
      />
      <Payments searchParams={searchParams} />
    </MoneyPage>
  );
}

async function Payments({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { q, page } = listParamsSchema.parse(sp);
  const ctx = await requireTenantContext("payments.manage");
  const [list, companies] = await Promise.all([
    listCompanyPayments(ctx, {
      q,
      page,
      companyId: filterParam(sp, "companyId"),
      ...parseDateRange(sp),
    }),
    companyOptions(ctx),
  ]);
  return (
    <>
      <Notice notice={sp.notice} />
      <ListToolbar
        basePath="/purchases/payments"
        params={{ q, status: "all" }}
        showStatus={false}
        searchPlaceholder="Payment no., company or reference"
        dateRange={{ from: filterParam(sp, "from"), to: filterParam(sp, "to"), label: "Paid" }}
        filters={[
          {
            name: "companyId",
            label: "Company",
            value: filterParam(sp, "companyId"),
            options: companies.map((c) => ({ value: c.id, label: c.name })),
          },
        ]}
      />
      <DataTable>
        <thead>
          <tr>
            <Th>Payment</Th>
            <Th>Date</Th>
            <Th>Company</Th>
            <Th>Method</Th>
            <Th className="text-right">Amount</Th>
            <Th className="text-right">Applied to bills</Th>
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <EmptyRow colSpan={6}>No payments match these filters.</EmptyRow>
          ) : null}
          {list.rows.map((p) => (
            <tr key={p.id}>
              <Td>
                <Link
                  href={`/purchases/payments/${p.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  #{p.number}
                </Link>{" "}
                <PostingBadge status={p.status} />
              </Td>
              <Td className="whitespace-nowrap">{formatDate(p.paymentDate)}</Td>
              <Td>{p.company.name}</Td>
              <Td>
                {METHOD[p.method]}
                {p.cheque ? (
                  <span className="text-muted-foreground"> {p.cheque.chequeNo}</span>
                ) : p.reference ? (
                  <span className="text-muted-foreground"> {p.reference}</span>
                ) : null}
              </Td>
              <Td className="text-right tabular-nums">{formatMoney(p.amount)}</Td>
              <Td className="text-right tabular-nums">{formatMoney(p.allocated)}</Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pagination
        basePath="/purchases/payments"
        searchParams={sp}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </>
  );
}
