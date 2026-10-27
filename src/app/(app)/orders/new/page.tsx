import type { Metadata } from "next";

import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { OrderEntry } from "@/components/sales/order-entry";
import { addDays } from "@/server/services/purchasing/calc";
import { businessToday, toDateInput } from "@/lib/dates";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { filterParam } from "@/lib/list-params";
import { saveSalesOrderAction } from "@/server/sales-actions";
import { parseDateRange } from "@/server/services/purchasing/filters";
import { areasForOrders } from "@/server/services/master/areas";
import { warehouseOptions } from "@/server/services/master/warehouses";
import { customersForOrders } from "@/server/services/sales/orders";

export const metadata: Metadata = { title: "New order" };

export default async function NewOrderPage({ searchParams }: PageProps<"/orders/new">) {
  const sp = await searchParams;
  const { notice, last } = sp;
  const ctx = await requireTenantContext("operations.manage");
  const lastId = filterParam(sp, "last");
  const [customers, warehouses, lastOrder, areas] = await Promise.all([
    customersForOrders(ctx),
    warehouseOptions(ctx),
    lastId
      ? ctx.db.salesOrder.findUnique({
          where: { id: lastId },
          select: { id: true, number: true, customer: { select: { name: true } } },
        })
      : null,
    areasForOrders(ctx),
  ]);
  const today = businessToday();
  // ?date= keeps the delivery date of the order just saved; ?customerId= starts with a customer.
  const date = parseDateRange({ from: sp.date }).from;
  const customerId = filterParam(sp, "customerId");
  return (
    <>
      <BackLink href="/orders">Orders</BackLink>
      <PageHeader
        title="New order"
        description="Usually for tomorrow's delivery, as reported by the company's order booker."
      />
      <Notice
        notice={notice}
        text={
          lastOrder
            ? `Order #${lastOrder.number} for ${lastOrder.customer.name} booked.`
            : undefined
        }
        next={
          lastOrder
            ? [
                { href: `/orders/${lastOrder.id}`, label: "Open it" },
                { href: `/orders/${lastOrder.id}/bill`, label: "Print its bill" },
              ]
            : []
        }
      />
      <OrderEntry
        key={`${String(last ?? "")}:${customerId ?? ""}`}
        action={saveSalesOrderAction.bind(null, null)}
        customers={customers}
        warehouses={warehouses}
        areas={areas}
        canOverrideCredit={can(ctx.user.role, "orders.overrideCreditLimit")}
        initial={{
          orderDate: toDateInput(today),
          deliveryDate: toDateInput(date ?? addDays(today, 1)),
          customerId: customers.some((c) => c.id === customerId) ? customerId : undefined,
        }}
      />
    </>
  );
}
