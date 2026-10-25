import type { Metadata } from "next";

import { BackLink, EmptyState, PageHeader } from "@/components/layout/page-header";
import { GoodsReceiptForm } from "@/components/purchasing/goods-receipt-form";
import { businessToday, toDateInput } from "@/lib/dates";
import { filterParam } from "@/lib/list-params";
import { quantityText } from "@/lib/units";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { saveGoodsReceiptAction } from "@/server/purchasing-actions";
import {
  getPurchaseOrder,
  openPurchaseOrders,
  productsForPurchasing,
} from "@/server/services/purchasing/purchase-orders";
import { ServiceError } from "@/server/services/errors";

export const metadata: Metadata = { title: "Receive goods" };

const dz = (packets: number) => quantityText(packets);

export default async function NewGoodsReceiptPage({
  searchParams,
}: PageProps<"/purchases/receipts/new">) {
  const sp = await searchParams;
  const ctx = await requireTenantContext("operations.manage");
  const [companies, products, open] = await Promise.all([
    ctx.db.company.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, paymentTermsDays: true },
    }),
    productsForPurchasing(ctx),
    openPurchaseOrders(ctx),
  ]);
  const poId = filterParam(sp, "purchaseOrderId");
  const po = poId
    ? await getPurchaseOrder(ctx, poId).catch((e) =>
        e instanceof ServiceError ? null : Promise.reject(e),
      )
    : null;
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  return (
    <>
      <BackLink href="/purchases/receipts">Goods receipts</BackLink>
      <PageHeader
        title="Receive goods"
        description="Enter what actually arrived, in dozens. It can be less or more than ordered."
      />
      {companies.length === 0 ? (
        <EmptyState>Add a company and its products first.</EmptyState>
      ) : (
        <GoodsReceiptForm
          key={po?.id ?? "none"}
          action={saveGoodsReceiptAction}
          companies={companies}
          products={products}
          openOrders={open.map((o) => ({ ...o, companyName: companyName.get(o.companyId) ?? "" }))}
          order={
            po && (po.status === "OPEN" || po.status === "PARTIALLY_RECEIVED")
              ? {
                  id: po.id,
                  number: po.number,
                  companyId: po.companyId,
                  lines: Object.fromEntries(
                    po.lines.map((l) => [
                      l.productId,
                      {
                        ordered: dz(l.quantity),
                        remaining: dz(Math.max(l.quantity - l.received, 0)),
                        quantity: l.quantity > l.received ? dz(l.quantity - l.received) : "",
                        rate: l.rate?.toFixed(2),
                      },
                    ]),
                  ),
                }
              : null
          }
          receivedDate={toDateInput(businessToday())}
          showRate={can(ctx.user.role, "financials.view")}
          canSetDueDate={can(ctx.user.role, "payments.manage")}
        />
      )}
    </>
  );
}
