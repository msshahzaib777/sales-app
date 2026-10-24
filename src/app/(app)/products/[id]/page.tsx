import type { Metadata } from "next";

import { DataTable, Td, Th } from "@/components/list/data-table";
import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { orNotFound } from "@/components/master/page-helpers";
import { RecordForm } from "@/components/master/record-form";
import { RecordStatusActions } from "@/components/master/record-status-actions";
import { businessToday, formatDate, toDateInput } from "@/lib/dates";
import { formatDateTime, formatDiscount, formatMoney } from "@/lib/format";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import { saveRecordAction } from "@/server/master-actions";
import { companyOptions } from "@/server/services/master/companies";
import { getProduct } from "@/server/services/master/products";

import { productFields } from "../product-fields";

export const metadata: Metadata = { title: "Edit product" };

type SlabSnapshot = { minQuantity: number; discountType: string; discountValue: string };

export default function EditProductPage({ params }: PageProps<"/products/[id]">) {
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/products">Products</BackLink>
      <Editor params={params} />
    </RequirePermission>
  );
}

async function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireTenantContext("masterData.manage");
  const [product, companies] = await Promise.all([
    orNotFound(getProduct(ctx, id)),
    companyOptions(ctx),
  ]);
  const companyList = companies.some((c) => c.id === product.companyId)
    ? companies
    : [
        ...companies,
        {
          id: product.companyId,
          name: "(deactivated company)",
          warehouseId: "",
          warehouse: { name: "" },
        },
      ];

  return (
    <div className="space-y-8">
      <PageHeader title={product.name} description={product.code} />
      <RecordForm
        action={saveRecordAction.bind(null, "Product", id)}
        fields={productFields(
          {
            ...product,
            purchaseRate: product.purchaseRate.toFixed(2),
            saleRate: product.saleRate.toFixed(2),
            discountValue: product.discountValue.toFixed(2),
            slabs: product.discountTiers.map((t) => ({
              minQuantity: t.minQuantity,
              discountValue: t.discountValue.toFixed(2),
            })),
          },
          companyList,
          toDateInput(businessToday()),
        )}
        isNew={false}
        cancelHref="/products"
      />

      <section aria-labelledby="history-heading" className="max-w-4xl">
        <h2 id="history-heading" className="mb-3 font-medium">
          Price history
        </h2>
        <DataTable>
          <thead>
            <tr>
              <Th>Effective from</Th>
              <Th className="text-right">Purchase</Th>
              <Th className="text-right">Sale</Th>
              <Th>Discount</Th>
              <Th>Recorded</Th>
            </tr>
          </thead>
          <tbody>
            {product.priceHistory.map((h) => (
              <tr key={h.id}>
                <Td>{formatDate(h.effectiveFrom)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(h.purchaseRate)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(h.saleRate)}</Td>
                <Td>
                  {formatDiscount(h)}
                  {(h.discountTiers as SlabSnapshot[]).map((s) => (
                    <div key={s.minQuantity} className="text-muted-foreground text-xs">
                      from {formatDozens(s.minQuantity)}: {formatDiscount(s)}
                    </div>
                  ))}
                </Td>
                <Td className="text-muted-foreground">{formatDateTime(h.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </section>

      <RecordStatusActions
        entity="Product"
        id={id}
        label="this product"
        isActive={product.isActive}
        canDelete={false}
      />
    </div>
  );
}
