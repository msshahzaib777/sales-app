import type { Metadata } from "next";

import { OpeningStockForm } from "@/components/inventory/opening-stock-form";
import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { ListToolbar } from "@/components/list/list-toolbar";
import { businessToday, toDateInput } from "@/lib/dates";
import { filterParam } from "@/lib/list-params";
import { requireTenantContext } from "@/server/auth/session";
import { saveOpeningStockAction } from "@/server/inventory-actions";
import { openingStockSheet } from "@/server/services/inventory";
import { companyOptions } from "@/server/services/master/companies";
import { warehouseOptions } from "@/server/services/master/warehouses";

export const metadata: Metadata = { title: "Opening stock" };

/** First-day stock per product, without a company bill (the goods were bought before the app). */
export default function OpeningStockPage({ searchParams }: PageProps<"/inventory/opening">) {
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/inventory">Inventory</BackLink>
      <PageHeader
        title="Opening stock"
        description="The stock you already have when you start using the app. No company bill is made for it. Change it any time; only the difference is recorded."
      />
      <Sheet searchParams={searchParams} />
    </RequirePermission>
  );
}

async function Sheet({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireTenantContext("masterData.manage");
  const warehouseId = filterParam(sp, "warehouseId");
  const companyId = filterParam(sp, "companyId");
  const [rows, warehouses, companies] = await Promise.all([
    openingStockSheet(ctx, { warehouseId, companyId }),
    warehouseOptions(ctx),
    companyOptions(ctx),
  ]);
  return (
    <>
      <ListToolbar
        basePath="/inventory/opening"
        params={{ q: undefined, status: "all" }}
        showStatus={false}
        showSearch={false}
        filters={[
          {
            name: "warehouseId",
            label: "Warehouse",
            value: warehouseId,
            options: warehouses.map((w) => ({ value: w.id, label: w.name })),
          },
          {
            name: "companyId",
            label: "Company",
            value: companyId,
            options: companies.map((c) => ({ value: c.id, label: c.name })),
          },
        ]}
      />
      <OpeningStockForm
        key={`${warehouseId ?? ""}-${companyId ?? ""}`}
        action={saveOpeningStockAction}
        rows={rows}
        today={toDateInput(businessToday())}
      />
    </>
  );
}
