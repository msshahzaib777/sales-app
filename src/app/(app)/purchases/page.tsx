import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { PageHeader } from "@/components/layout/page-header";
import { LinkButton } from "@/components/master/page-helpers";
import { PurchaseOrderBadge } from "@/components/purchasing/status-badges";
import { formatDate } from "@/lib/dates";
import { filterParam, listParamsSchema } from "@/lib/list-params";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import { companyOptions } from "@/server/services/master/companies";
import { parseDateRange } from "@/server/services/purchasing/filters";
import { listPurchaseOrders } from "@/server/services/purchasing/purchase-orders";

export const metadata: Metadata = { title: "Purchase orders" };

const STATUS_OPTIONS = [
  { value: "OPEN", label: "Open" },
  { value: "PARTIALLY_RECEIVED", label: "Partly received" },
  { value: "RECEIVED", label: "Received" },
  { value: "CLOSED", label: "Closed" },
  { value: "CANCELLED", label: "Cancelled" },
];

export default async function PurchaseOrdersPage({ searchParams }: PageProps<"/purchases">) {
  const sp = await searchParams;
  const { q, page } = listParamsSchema.parse(sp);
  const range = parseDateRange(sp);
  const ctx = await requireTenantContext("operations.manage");
  const [list, companies] = await Promise.all([
    listPurchaseOrders(ctx, {
      q,
      page,
      ...range,
      companyId: filterParam(sp, "companyId"),
      status: filterParam(sp, "status"),
    }),
    companyOptions(ctx),
  ]);
  return (
    <>
      <PageHeader
        title="Purchase orders"
        description="What you ordered from companies. Receiving goods creates the stock and the company bill."
        actions={
          <>
            <LinkButton href="/purchases/receipts/new" variant="outline">
              Receive goods
            </LinkButton>
            <LinkButton href="/purchases/orders/new">New purchase order</LinkButton>
          </>
        }
      />
      <ListToolbar
        basePath="/purchases"
        params={{ q, status: "all" }}
        showStatus={false}
        searchPlaceholder="PO number or company"
        dateRange={{ from: filterParam(sp, "from"), to: filterParam(sp, "to"), label: "Ordered" }}
        filters={[
          {
            name: "companyId",
            label: "Company",
            value: filterParam(sp, "companyId"),
            options: companies.map((c) => ({ value: c.id, label: c.name })),
          },
          {
            name: "status",
            label: "Status",
            value: filterParam(sp, "status"),
            options: STATUS_OPTIONS,
          },
        ]}
      />
      <DataTable>
        <thead>
          <tr>
            <Th>PO</Th>
            <Th>Ordered</Th>
            <Th>Company</Th>
            <Th>Expected</Th>
            <Th className="text-right">Products</Th>
            <Th className="text-right">Quantity</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <EmptyRow colSpan={7}>No purchase orders match these filters.</EmptyRow>
          ) : null}
          {list.rows.map((po) => (
            <tr key={po.id}>
              <Td>
                <Link
                  href={`/purchases/orders/${po.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  #{po.number}
                </Link>
              </Td>
              <Td className="whitespace-nowrap">{formatDate(po.orderDate)}</Td>
              <Td>{po.company.name}</Td>
              <Td className="whitespace-nowrap">
                {po.expectedDate ? formatDate(po.expectedDate) : "—"}
              </Td>
              <Td className="text-right tabular-nums">{po.lineCount}</Td>
              <Td className="text-right tabular-nums">{formatDozens(po.orderedQty)}</Td>
              <Td>
                <PurchaseOrderBadge status={po.status} />
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pagination
        basePath="/purchases"
        searchParams={sp}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </>
  );
}
