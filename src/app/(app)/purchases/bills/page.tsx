import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { PageHeader } from "@/components/layout/page-header";
import { MoneyPage } from "@/components/purchasing/money-guard";
import { BillStatusBadge } from "@/components/purchasing/status-badges";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { filterParam, listParamsSchema } from "@/lib/list-params";
import { requireTenantContext } from "@/server/auth/session";
import { companyOptions } from "@/server/services/master/companies";
import {
  BILL_FILTERS,
  type BillFilter,
  listCompanyBills,
} from "@/server/services/purchasing/bills";
import { parseDateRange } from "@/server/services/purchasing/filters";

export const metadata: Metadata = { title: "Company bills" };

const SHOW_OPTIONS = [
  { value: "open", label: "Unpaid & partial" },
  { value: "overdue", label: "Overdue" },
  { value: "paid", label: "Paid" },
  { value: "all", label: "All" },
];

export default function CompanyBillsPage({ searchParams }: PageProps<"/purchases/bills">) {
  return (
    <MoneyPage>
      <PageHeader
        title="Company bills"
        description="What you owe companies for received goods, with due dates."
      />
      <Bills searchParams={searchParams} />
    </MoneyPage>
  );
}

async function Bills({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { q, page } = listParamsSchema.parse(sp);
  const show = (BILL_FILTERS as readonly string[]).includes(filterParam(sp, "show") ?? "")
    ? (filterParam(sp, "show") as BillFilter)
    : "open";
  const ctx = await requireTenantContext("payments.manage");
  const [list, companies] = await Promise.all([
    listCompanyBills(ctx, {
      q,
      filter: show,
      page,
      companyId: filterParam(sp, "companyId"),
      ...parseDateRange(sp),
    }),
    companyOptions(ctx),
  ]);
  return (
    <>
      <ListToolbar
        basePath="/purchases/bills"
        params={{ q, status: "all" }}
        showStatus={false}
        searchPlaceholder="Bill no. or company"
        dateRange={{ from: filterParam(sp, "from"), to: filterParam(sp, "to"), label: "Billed" }}
        filters={[
          { name: "show", label: "Show", value: show, options: SHOW_OPTIONS, required: true },
          {
            name: "companyId",
            label: "Company",
            value: filterParam(sp, "companyId"),
            options: companies.map((c) => ({ value: c.id, label: c.name })),
          },
        ]}
      />
      <p className="mb-3 text-sm">
        Outstanding: <strong>{formatMoney(list.totals.outstanding)}</strong> · of which overdue:{" "}
        <strong>{formatMoney(list.totals.overdue)}</strong>
      </p>
      <DataTable>
        <thead>
          <tr>
            <Th>Bill</Th>
            <Th>Company</Th>
            <Th>Billed</Th>
            <Th>Due</Th>
            <Th className="text-right">Amount</Th>
            <Th className="text-right">Paid</Th>
            <Th className="text-right">Outstanding</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <EmptyRow colSpan={8}>No bills match these filters.</EmptyRow>
          ) : null}
          {list.rows.map((b) => (
            <tr key={b.id}>
              <Td>
                <Link
                  href={`/purchases/bills/${b.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  #{b.number}
                </Link>
                {b.receiptNumber === null ? (
                  <span className="text-muted-foreground"> Opening balance</span>
                ) : null}
              </Td>
              <Td>
                <Link
                  href={`/companies/${b.companyId}/ledger`}
                  className="underline-offset-4 hover:underline"
                >
                  {b.companyName}
                </Link>
              </Td>
              <Td className="whitespace-nowrap">{formatDate(b.billDate)}</Td>
              <Td className="whitespace-nowrap">{formatDate(b.dueDate)}</Td>
              <Td className="text-right tabular-nums">{formatMoney(b.netAmount)}</Td>
              <Td className="text-right tabular-nums">{formatMoney(b.paid)}</Td>
              <Td className="text-right font-medium tabular-nums">{formatMoney(b.outstanding)}</Td>
              <Td>
                <BillStatusBadge state={b} />
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pagination
        basePath="/purchases/bills"
        searchParams={sp}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </>
  );
}
