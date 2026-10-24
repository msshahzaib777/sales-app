import type { Metadata } from "next";

import { ConfirmAction } from "@/components/form/confirm-action";
import { DataTable, Td, Th } from "@/components/list/data-table";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { LinkButton, orNotFound } from "@/components/master/page-helpers";
import { OrderStatusBadge } from "@/components/sales/order-badges";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";
import { formatDateTime, formatDiscount, formatMoney } from "@/lib/format";
import { isOpenOrder } from "@/lib/sales";
import { formatDozens } from "@/lib/units";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { approveCreditAction, cancelSalesOrderAction } from "@/server/sales-actions";
import { getSalesOrder } from "@/server/services/sales/orders";

export const metadata: Metadata = { title: "Order" };

const SOURCE = { OFFICE: "office", WHATSAPP: "WhatsApp", BOOKER_APP: "booker app" } as const;

export default async function OrderPage({ params, searchParams }: PageProps<"/orders/[id]">) {
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  const ctx = await requireTenantContext("operations.manage");
  const order = await orNotFound(getSalesOrder(ctx, id));
  const open = isOpenOrder(order.status);
  const companies = [...new Set(order.lines.map((l) => l.company.name))];

  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/orders">Orders</BackLink>
        <PageHeader
          title={`Order #${order.number}`}
          description={`${order.customer.name}${order.customer.shopName ? `, ${order.customer.shopName}` : ""} · ${order.customer.area?.name ?? order.warehouse.name} · deliver ${formatDate(order.deliveryDate)} · via ${SOURCE[order.source]}`}
          actions={
            <>
              {order.bill ? (
                <LinkButton href={`/orders/${order.id}/bill`} variant="outline">
                  Bill #{order.bill.number}
                </LinkButton>
              ) : null}
              {open ? <LinkButton href={`/orders/${order.id}/edit`}>Edit</LinkButton> : null}
            </>
          }
        />
        <Notice notice={notice} />
        <OrderStatusBadge status={order.status} needsCreditApproval={order.needsCreditApproval} />
        {order.creditOverrideAt ? (
          <p className="mt-2 text-sm">
            Allowed past the credit limit on {formatDateTime(order.creditOverrideAt)}.
          </p>
        ) : null}
        {order.note ? <p className="mt-2 text-sm">{order.note}</p> : null}
      </div>

      <DataTable>
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Product</Th>
            {companies.length > 1 ? <Th>Company</Th> : null}
            <Th className="text-right">Dozens</Th>
            {open ? <Th className="text-right">Available</Th> : null}
            <Th className="text-right">Rate / dz</Th>
            <Th>Discount</Th>
            <Th className="text-right">Amount</Th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l) => (
            <tr key={l.id}>
              <Td className="font-mono">{l.product.code}</Td>
              <Td>{l.product.name}</Td>
              {companies.length > 1 ? <Td>{l.company.name}</Td> : null}
              <Td className="text-right tabular-nums">{formatDozens(l.quantity)}</Td>
              {open ? (
                <Td className="text-right tabular-nums">
                  {l.available !== null ? formatDozens(l.available) : "—"}
                  {l.available !== null && l.quantity > l.available ? (
                    <Badge variant="destructive" className="ml-1">
                      Short {formatDozens(l.quantity - l.available)}
                    </Badge>
                  ) : null}
                </Td>
              ) : null}
              <Td className="text-right tabular-nums">{formatMoney(l.rate)}</Td>
              <Td>
                {l.discountAmount.gt(0)
                  ? `${formatDiscount(l)} (−${formatMoney(l.discountAmount)})`
                  : "—"}
              </Td>
              <Td className="text-right tabular-nums">{formatMoney(l.netAmount)}</Td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-medium">
            <Td>Total</Td>
            <Td />
            {companies.length > 1 ? <Td /> : null}
            <Td className="text-right tabular-nums">
              {formatDozens(order.lines.reduce((s, l) => s + l.quantity, 0))}
            </Td>
            {open ? <Td /> : null}
            <Td />
            <Td />
            <Td className="text-right tabular-nums">{formatMoney(order.bill?.netAmount)}</Td>
          </tr>
        </tfoot>
      </DataTable>

      {order.bill && order.bill.revisions.length > 0 ? (
        <section aria-labelledby="revisions-heading" className="max-w-xl">
          <h2 id="revisions-heading" className="mb-2 font-medium">
            Bill revisions
          </h2>
          <ul className="space-y-1 text-sm">
            {order.bill.revisions.map((r) => (
              <li key={r.revision} className="flex justify-between gap-3">
                <span>
                  Revision {r.revision}: {r.reason}{" "}
                  <span className="text-muted-foreground">({formatDateTime(r.createdAt)})</span>
                </span>
                <span className="tabular-nums">{formatMoney(r.netAmount)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {open ? (
        <div className="flex flex-wrap gap-2 print:hidden">
          {order.needsCreditApproval && can(ctx.user.role, "orders.overrideCreditLimit") ? (
            <ConfirmAction
              action={approveCreditAction.bind(null, order.id)}
              label="Approve past credit limit"
              confirm={`Allow order #${order.number} past the customer's credit limit?`}
            />
          ) : null}
          <ConfirmAction
            action={cancelSalesOrderAction.bind(null, order.id)}
            label="Cancel order"
            confirm={`Cancel order #${order.number}? Its stock is released.`}
          />
        </div>
      ) : null}
    </div>
  );
}
