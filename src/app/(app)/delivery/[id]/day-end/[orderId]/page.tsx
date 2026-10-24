import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { DayEndForm } from "@/components/delivery/day-end-form";
import { ReasonAction } from "@/components/form/reason-action";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { DataTable, Td, Th } from "@/components/list/data-table";
import { Notice } from "@/components/master/notice";
import { orNotFound } from "@/components/master/page-helpers";
import { OrderStatusBadge } from "@/components/sales/order-badges";
import { formatDate, toDateInput } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import type { DiscountType } from "@/lib/pricing";
import { formatDozens } from "@/lib/units";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { saveDayEndAction, undoDayEndAction } from "@/server/delivery-actions";
import { getDayEndEntry } from "@/server/services/delivery/day-end";

export const metadata: Metadata = { title: "Day-end entry" };

const METHOD = { CASH: "Cash", CHEQUE: "Cheque", ONLINE: "Online" } as const;

export default async function DayEndPage({
  params,
  searchParams,
}: PageProps<"/delivery/[id]/day-end/[orderId]">) {
  const [{ id, orderId }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireTenantContext("operations.manage");
  const order = await orNotFound(getDayEndEntry(ctx, orderId));
  if (order.trip.id !== id) notFound();
  const done = order.reconciledAt !== null;

  return (
    <div className="space-y-6">
      <div>
        <BackLink href={`/delivery/${id}`}>
          Trip #{order.trip.number} · {formatDate(order.trip.tripDate)} · {order.trip.bike.name} ·{" "}
          {order.trip.driver?.name ?? "no driver set"}
        </BackLink>
        <PageHeader
          title={`Day-end · order #${order.number}`}
          description={`${order.customer.name}${order.customer.shopName ? ` · ${order.customer.shopName}` : ""}${order.customer.area ? ` · ${order.customer.area.name}` : ""} · bill #${order.bill?.number}`}
          actions={
            <Link
              href={`/orders/${order.id}/bill`}
              className="text-sm underline underline-offset-4"
            >
              View bill
            </Link>
          }
        />
      </div>
      <Notice notice={sp.notice} />

      {order.status === "DISPATCHED" ? (
        <DayEndForm
          key={order.id}
          action={saveDayEndAction}
          orderId={order.id}
          tripDate={toDateInput(order.trip.tripDate)}
          previous={order.bill!.previousBalance.toFixed(2)}
          billBefore={order.bill!.netAmount.toFixed(2)}
          creditLimit={order.customer.creditLimit?.toFixed(2) ?? null}
          lines={order.lines.map((l) => ({
            productId: l.productId,
            companyId: l.companyId,
            quantity: l.quantity,
            rate: l.rate.toFixed(2),
            discountType: l.discountType as DiscountType,
            discountValue: l.discountValue.toFixed(2),
            code: l.product.code,
            name: l.product.name,
            companyName: l.company.name,
          }))}
        />
      ) : done ? (
        <div className="space-y-6">
          <p className="flex items-center gap-2 text-sm">
            <OrderStatusBadge status={order.status} /> Day-end entered. Changes now go through
            corrections by the owner.
          </p>
          <DataTable>
            <thead>
              <tr>
                <Th>Product</Th>
                <Th className="text-right">Sent</Th>
                <Th className="text-right">Returned</Th>
                <Th className="text-right">Damaged</Th>
                <Th className="text-right">Delivered</Th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((l) => (
                <tr key={l.id}>
                  <Td>
                    {l.product.code} {l.product.name}
                    <div className="text-muted-foreground">{l.company.name}</div>
                  </Td>
                  <Td className="text-right tabular-nums">{formatDozens(l.quantity)}</Td>
                  <Td className="text-right tabular-nums">
                    {l.returnedQuantity ? formatDozens(l.returnedQuantity) : ""}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {l.damagedQuantity ? formatDozens(l.damagedQuantity) : ""}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatDozens(l.quantity - l.returnedQuantity - l.damagedQuantity)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <section aria-labelledby="paid-heading">
            <h2 id="paid-heading" className="mb-2 font-medium">
              Collected
            </h2>
            {order.payments.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nothing collected.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {order.payments.map((p) => (
                  <li key={p.id}>
                    Payment #{p.number}: {METHOD[p.method]}{" "}
                    {p.cheque
                      ? `${p.cheque.chequeNo} (${p.cheque.bankName}) `
                      : p.reference
                        ? `${p.reference} `
                        : ""}
                    <strong className="tabular-nums">{formatMoney(p.amount)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <p className="text-sm">
            Bill now <strong className="tabular-nums">{formatMoney(order.bill?.netAmount)}</strong>{" "}
            · customer owes now{" "}
            <strong className="tabular-nums">{formatMoney(order.pendingNow)}</strong>
          </p>
          {can(ctx.user.role, "payments.manage") ? (
            <ReasonAction
              action={undoDayEndAction.bind(null, order.id)}
              label="Undo day-end"
              description="For a day-end entered wrongly. Returns and damage go back out of stock, the damage claims are cancelled, the bill goes back to what was dispatched and the payments collected are reversed. Then enter it again."
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              Entered wrongly? The owner or accountant can undo it so it can be entered again.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm">This order has not been dispatched yet.</p>
      )}
    </div>
  );
}
