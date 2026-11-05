import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { RateSheetEditor } from "@/components/master/rate-sheet-editor";
import { requireTenantContext } from "@/server/auth/session";
import { saveRateSheetAction } from "@/server/master-actions";
import { getRateSheet } from "@/server/services/master/rate-sheet";

export const metadata: Metadata = { title: "Edit rates" };

/** Products → Edit rates: rates, discounts, quantity slabs and minimum stock in one sheet. */
export default function RateSheetPage() {
  return (
    <RequirePermission permission="rates.manage">
      <BackLink href="/products">Products</BackLink>
      <PageHeader
        title="Edit rates"
        description="Every product in one sheet: change rates, discounts, quantity slabs and minimum stock, or select rows for a bulk change. New rates apply to orders from now on; booked orders keep theirs. Each change is kept in the product's price history."
      />
      <Sheet />
    </RequirePermission>
  );
}

async function Sheet() {
  const ctx = await requireTenantContext("rates.manage");
  const sheet = await getRateSheet(ctx);
  return (
    <RateSheetEditor
      rows={sheet.rows}
      companies={sheet.companies}
      showCost={sheet.showCost}
      action={saveRateSheetAction}
    />
  );
}
