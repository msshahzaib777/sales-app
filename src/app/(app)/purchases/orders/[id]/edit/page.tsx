import type { Metadata } from "next";

import { BackLink, PageHeader } from "@/components/layout/page-header";
import { orNotFound } from "@/components/master/page-helpers";
import { PurchaseOrderForm } from "@/components/purchasing/purchase-order-form";
import { toDateInput } from "@/lib/dates";
import { quantityText } from "@/lib/units";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { savePurchaseOrderAction } from "@/server/purchasing-actions";
import { companyOptions } from "@/server/services/master/companies";
import {
  getPurchaseOrder,
  productsForPurchasing,
} from "@/server/services/purchasing/purchase-orders";

export const metadata: Metadata = { title: "Edit purchase order" };

export default async function EditPurchaseOrderPage({
  params,
}: PageProps<"/purchases/orders/[id]/edit">) {
  const { id } = await params;
  const ctx = await requireTenantContext("operations.manage");
  const [po, companies, products] = await Promise.all([
    orNotFound(getPurchaseOrder(ctx, id)),
    companyOptions(ctx),
    productsForPurchasing(ctx),
  ]);
  return (
    <>
      <BackLink href={`/purchases/orders/${id}`}>PO #{po.number}</BackLink>
      <PageHeader title={`Edit PO #${po.number}`} />
      <PurchaseOrderForm
        action={savePurchaseOrderAction.bind(null, id)}
        companies={
          companies.some((c) => c.id === po.companyId)
            ? companies
            : [
                ...companies,
                {
                  id: po.companyId,
                  name: po.company.name,
                  warehouseId: "",
                  warehouse: { name: "" },
                },
              ]
        }
        products={products}
        initial={{
          companyId: po.companyId,
          orderDate: toDateInput(po.orderDate),
          expectedDate: po.expectedDate ? toDateInput(po.expectedDate) : undefined,
          note: po.note ?? undefined,
          lines: Object.fromEntries(
            po.lines.map((l) => [
              l.productId,
              { quantity: quantityText(l.quantity), rate: l.rate?.toFixed(2) },
            ]),
          ),
        }}
        showRate={can(ctx.user.role, "financials.view")}
        isNew={false}
      />
    </>
  );
}
