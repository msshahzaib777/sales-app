import type { Metadata } from "next";

import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { OrderEntry } from "@/components/sales/order-entry";
import { addDays } from "@/server/services/purchasing/calc";
import { businessToday, toDateInput } from "@/lib/dates";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { saveSalesOrderAction } from "@/server/sales-actions";
import { warehouseOptions } from "@/server/services/master/warehouses";
import { customersForOrders } from "@/server/services/sales/orders";

export const metadata: Metadata = { title: "New order" };

export default async function NewOrderPage({ searchParams }: PageProps<"/orders/new">) {
  const { notice, last } = await searchParams;
  const ctx = await requireTenantContext("operations.manage");
  const [customers, warehouses] = await Promise.all([
    customersForOrders(ctx),
    warehouseOptions(ctx),
  ]);
  const today = businessToday();
  return (
    <>
      <BackLink href="/orders">Orders</BackLink>
      <PageHeader
        title="New order"
        description="Usually for tomorrow's delivery, as reported by the company's order booker."
      />
      <Notice notice={notice} />
      <OrderEntry
        key={String(last ?? "")}
        action={saveSalesOrderAction.bind(null, null)}
        customers={customers}
        warehouses={warehouses}
        canOverrideCredit={can(ctx.user.role, "orders.overrideCreditLimit")}
        initial={{ orderDate: toDateInput(today), deliveryDate: toDateInput(addDays(today, 1)) }}
      />
    </>
  );
}
