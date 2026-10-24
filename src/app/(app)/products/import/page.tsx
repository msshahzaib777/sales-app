import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { ImportPanel } from "@/components/master/import-panel";
import { IMPORT_NOTES, templateHeaders } from "@/server/services/master/import-rows";

export const metadata: Metadata = { title: "Import products" };

export default function ImportProductsPage() {
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/products">Products</BackLink>
      <PageHeader
        title="Import products"
        description="Add or update many products from an Excel or CSV file."
      />
      <ImportPanel
        kind="products"
        templateHeaders={templateHeaders("products")}
        notes={IMPORT_NOTES.products}
      />
    </RequirePermission>
  );
}
