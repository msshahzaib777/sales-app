import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { SelectAll } from "@/components/list/select-all";
import { Pagination } from "@/components/list/pagination";
import { PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";

import { LinkButton } from "@/components/master/page-helpers";
import { OrderStatusBadge } from "@/components/sales/order-badges";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { filterParam, listParamsSchema } from "@/lib/list-params";
import { ORDER_STATUS_LABEL, ORDER_STATUSES } from "@/lib/sales";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import { areaOptions } from "@/server/services/master/areas";
import { parseDateRange } from "@/server/services/purchasing/filters";
import { listSalesOrders } from "@/server/services/sales/orders";

export const metadata: Metadata = { title: "Orders" };

const STATUS_OPTIONS = [
  { value: "open", label: "Open (booked or planned)" },
  ...ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABEL[s] })),
];

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  const sp = await searchParams;
  const { q, page } = listParamsSchema.parse(sp);
  const ctx = await requireTenantContext("operations.manage");
  const [list, areas] = await Promise.all([
    listSalesOrders(ctx, {
      q,
      page,
      status: filterParam(sp, "orderStatus"),
      areaId: filterParam(sp, "areaId"),
      needsApproval: filterParam(sp, "approval") === "needed",
      fulfilment: filterParam(sp, "type"),
      ...parseDateRange(sp),
    }),
    areaOptions(ctx),
  ]);
  return (
    <>
      <PageHeader
        title="Orders"
        description="Customer orders for delivery, and counter sales collected at the warehouse. Booked and planned orders reserve stock until dispatch."
        actions={
          <>
            <LinkButton href="/orders/counter" variant="outline">
              Counter sale
            </LinkButton>
            <LinkButton href="/orders/new">New order</LinkButton>
          </>
        }
      />
      <Notice notice={sp.notice} />
      <ListToolbar
        basePath="/orders"
        params={{ q, status: "all" }}
        showStatus={false}
        searchPlaceholder="Order no., customer, shop or phone"
        dateRange={{ from: filterParam(sp, "from"), to: filterParam(sp, "to"), label: "Delivery" }}
        filters={[
          {
            name: "orderStatus",
            label: "Status",
            value: filterParam(sp, "orderStatus"),
            options: STATUS_OPTIONS,
          },
          {
            name: "areaId",
            label: "Area",
            value: filterParam(sp, "areaId"),
            options: areas.map((a) => ({ value: a.id, label: `${a.name} · ${a.warehouse.name}` })),
          },
          {
            name: "type",
            label: "Type",
            value: filterParam(sp, "type"),
            options: [
              { value: "DELIVERY", label: "Deliveries" },
              { value: "COUNTER", label: "Counter sales" },
            ],
          },
          {
            name: "approval",
            label: "Credit",
            value: filterParam(sp, "approval"),
            options: [{ value: "needed", label: "Needs owner approval" }],
          },
        ]}
      />
      <p className="mb-3 text-sm">
        {list.total} {list.total === 1 ? "order" : "orders"} ·{" "}
        <strong>{formatMoney(list.totalAmount)}</strong>
      </p>
      {/* GET form: the ticked ids go to /orders/print?ids=…, which prints all their bills. */}
      <form action="/orders/print" method="get" target="_blank">
        <div className="mb-2 flex flex-wrap gap-2">
          <Button type="submit" variant="outline" size="sm">
            Print selected bills
          </Button>
          <Button type="submit" name="view" value="company" variant="outline" size="sm">
            Print selected, split by company
          </Button>
        </div>
        <DataTable>
          <thead>
            <tr>
              <Th className="w-8">
                <SelectAll name="ids" label="Select all orders on this page" />
              </Th>
              <Th>Order</Th>
              <Th>Date</Th>
              <Th>Customer</Th>
              <Th>Area</Th>
              <Th className="text-right">Dozens</Th>
              <Th className="text-right">Bill</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {list.rows.length === 0 ? (
              <EmptyRow colSpan={8}>No orders match these filters.</EmptyRow>
            ) : null}
            {list.rows.map((o) => (
              <tr key={o.id}>
                <Td>
                  {o.bill ? (
                    <input
                      type="checkbox"
                      name="ids"
                      value={o.id}
                      aria-label={`Select order #${o.number}`}
                      className="size-4 align-middle"
                    />
                  ) : null}
                </Td>
                <Td>
                  <Link
                    href={`/orders/${o.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    #{o.number}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap">{formatDate(o.deliveryDate)}</Td>
                <Td>
                  {o.customer.name}
                  {o.customer.shopName ? (
                    <div className="text-muted-foreground">{o.customer.shopName}</div>
                  ) : null}
                </Td>
                <Td>{o.customer.area?.name ?? "—"}</Td>
                <Td className="text-right tabular-nums">{formatDozens(o.quantity)}</Td>
                <Td className="text-right tabular-nums">
                  {o.bill ? formatMoney(o.bill.netAmount) : "—"}
                </Td>
                <Td>
                  <OrderStatusBadge
                    status={o.status}
                    needsCreditApproval={o.needsCreditApproval}
                    counter={o.fulfilment === "COUNTER"}
                  />
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </form>
      <Pagination
        basePath="/orders"
        searchParams={sp}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </>
  );
}
