import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { PageHeader } from "@/components/layout/page-header";
import { LinkButton } from "@/components/master/page-helpers";
import { PostingBadge } from "@/components/purchasing/status-badges";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { filterParam, listParamsSchema } from "@/lib/list-params";
import { formatDozens } from "@/lib/units";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { companyOptions } from "@/server/services/master/companies";
import { parseDateRange } from "@/server/services/purchasing/filters";
import { listGoodsReceipts } from "@/server/services/purchasing/goods-receipts";

export const metadata: Metadata = { title: "Goods receipts" };

export default async function GoodsReceiptsPage({
  searchParams,
}: PageProps<"/purchases/receipts">) {
  const sp = await searchParams;
  const { q, page } = listParamsSchema.parse(sp);
  const ctx = await requireTenantContext("operations.manage");
  const [list, companies] = await Promise.all([
    listGoodsReceipts(ctx, {
      q,
      page,
      ...parseDateRange(sp),
      companyId: filterParam(sp, "companyId"),
    }),
    companyOptions(ctx),
  ]);
  const showMoney = can(ctx.user.role, "financials.view");
  const showBills = can(ctx.user.role, "ledgers.view");
  return (
    <>
      <PageHeader
        title="Goods receipts"
        description="Stock received from companies. Each receipt adds a batch and creates a company bill."
        actions={<LinkButton href="/purchases/receipts/new">Receive goods</LinkButton>}
      />
      <ListToolbar
        basePath="/purchases/receipts"
        params={{ q, status: "all" }}
        showStatus={false}
        searchPlaceholder="Receipt no., company or invoice no."
        dateRange={{ from: filterParam(sp, "from"), to: filterParam(sp, "to"), label: "Received" }}
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
            <Th>Receipt</Th>
            <Th>Received</Th>
            <Th>Company</Th>
            <Th>Invoice no.</Th>
            <Th>PO</Th>
            <Th className="text-right">Quantity</Th>
            {showBills ? <Th>Bill</Th> : null}
            {showMoney ? <Th className="text-right">Bill amount</Th> : null}
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <EmptyRow colSpan={8}>No receipts match these filters.</EmptyRow>
          ) : null}
          {list.rows.map((r) => (
            <tr key={r.id}>
              <Td>
                <Link
                  href={`/purchases/receipts/${r.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  #{r.number}
                </Link>{" "}
                <PostingBadge status={r.status} />
              </Td>
              <Td className="whitespace-nowrap">{formatDate(r.receivedDate)}</Td>
              <Td>{r.company.name}</Td>
              <Td>{r.supplierRef ?? "—"}</Td>
              <Td>{r.purchaseOrder ? `#${r.purchaseOrder.number}` : "—"}</Td>
              <Td className="text-right tabular-nums">{formatDozens(r.receivedQty)}</Td>
              {showBills ? (
                <Td>
                  {r.bill ? (
                    <Link
                      href={`/purchases/bills/${r.bill.id}`}
                      className="underline-offset-4 hover:underline"
                    >
                      #{r.bill.number}
                    </Link>
                  ) : null}
                </Td>
              ) : null}
              {showMoney ? (
                <Td className="text-right tabular-nums">{formatMoney(r.bill?.netAmount)}</Td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pagination
        basePath="/purchases/receipts"
        searchParams={sp}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </>
  );
}
