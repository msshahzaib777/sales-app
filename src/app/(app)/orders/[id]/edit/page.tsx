import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { BackLink, PageHeader } from "@/components/layout/page-header";
import { orNotFound } from "@/components/master/page-helpers";
import { OrderEntry } from "@/components/sales/order-entry";
import { toDateInput } from "@/lib/dates";
import { isOpenOrder } from "@/lib/sales";
import { quantityText } from "@/lib/units";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { saveSalesOrderAction } from "@/server/sales-actions";
import { warehouseOptions } from "@/server/services/master/warehouses";
import { customersForOrders, getSalesOrder } from "@/server/services/sales/orders";

export const metadata: Metadata = { title: "Edit order" };

export default async function EditOrderPage({ params }: PageProps<"/orders/[id]/edit">) {
  const { id } = await params;
  const ctx = await requireTenantContext("operations.manage");
  const [order, customers, warehouses] = await Promise.all([
    orNotFound(getSalesOrder(ctx, id)),
    customersForOrders(ctx),
    warehouseOptions(ctx),
  ]);
  if (!isOpenOrder(order.status)) redirect(`/orders/${id}`);
  return (
    <>
      <BackLink href={`/orders/${id}`}>Order #{order.number}</BackLink>
      <PageHeader
        title={`Edit order #${order.number}`}
        description="Changes are kept as a new bill revision."
      />
      <OrderEntry
        action={saveSalesOrderAction.bind(null, id)}
        customers={
          customers.some((c) => c.id === order.customerId)
            ? customers
            : [
                ...customers,
                {
                  id: order.customerId,
                  name: order.customer.name,
                  shopName: order.customer.shopName,
                  phone: order.customer.phone,
                  area: order.customer.area
                    ? { name: order.customer.area.name, warehouseId: order.warehouseId }
                    : null,
                },
              ]
        }
        warehouses={warehouses}
        canOverrideCredit={can(ctx.user.role, "orders.overrideCreditLimit")}
        initial={{
          orderId: id,
          customerId: order.customerId,
          warehouseId: order.customer.areaId ? undefined : order.warehouseId,
          orderDate: toDateInput(order.orderDate),
          deliveryDate: toDateInput(order.deliveryDate),
          source: order.source,
          note: order.note ?? undefined,
          lines: order.lines.map((l) => ({
            productId: l.productId,
            qty: quantityText(l.quantity),
          })),
        }}
      />
    </>
  );
}
