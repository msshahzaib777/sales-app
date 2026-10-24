import type { Metadata } from "next";

import { AdjustmentForm } from "@/components/inventory/adjustment-form";
import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { filterParam } from "@/lib/list-params";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { saveAdjustmentAction } from "@/server/inventory-actions";
import { adjustmentFormOptions } from "@/server/services/stock-adjustments";

export const metadata: Metadata = { title: "Adjust stock" };

export default function NewAdjustmentPage({
  searchParams,
}: PageProps<"/inventory/adjustments/new">) {
  return (
    <RequirePermission permission="stock.requestAdjustment">
      <BackLink href="/inventory/adjustments">Stock adjustments</BackLink>
      <PageHeader
        title="Adjust stock"
        description="When the shelf and the app disagree, or stock got damaged in the warehouse."
      />
      <Form searchParams={searchParams} />
    </RequirePermission>
  );
}

async function Form({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireTenantContext("stock.requestAdjustment");
  const products = await adjustmentFormOptions(ctx);
  const productId = filterParam(sp, "productId");
  return (
    <AdjustmentForm
      action={saveAdjustmentAction}
      products={products}
      productId={products.some((p) => p.id === productId) ? productId : undefined}
      approvesOwn={can(ctx.user.role, "stock.approveAdjustment")}
    />
  );
}
