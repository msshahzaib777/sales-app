import type { Metadata } from "next";

import { BackLink, EmptyState, PageHeader } from "@/components/layout/page-header";
import { PurchaseOrderForm } from "@/components/purchasing/purchase-order-form";
import { businessToday, toDateInput } from "@/lib/dates";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { savePurchaseOrderAction } from "@/server/purchasing-actions";
import { companyOptions } from "@/server/services/master/companies";
import { productsForPurchasing } from "@/server/services/purchasing/purchase-orders";

export const metadata: Metadata = { title: "New purchase order" };

export default async function NewPurchaseOrderPage() {
  const ctx = await requireTenantContext("operations.manage");
  const [companies, products] = await Promise.all([
    companyOptions(ctx),
    productsForPurchasing(ctx),
  ]);
  return (
    <>
      <BackLink href="/purchases">Purchase orders</BackLink>
      <PageHeader
        title="New purchase order"
        description="Type quantities in dozens for the products you ordered; leave the rest blank."
      />
      {companies.length === 0 ? (
        <EmptyState>Add a company and its products first.</EmptyState>
      ) : (
        <PurchaseOrderForm
          action={savePurchaseOrderAction.bind(null, null)}
          companies={companies}
          products={products}
          initial={{ orderDate: toDateInput(businessToday()), lines: {} }}
          showRate={can(ctx.user.role, "financials.view")}
          isNew
        />
      )}
    </>
  );
}
