import type { Metadata } from "next";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { ImportPanel } from "@/components/master/import-panel";
import { requireTenantContext } from "@/server/auth/session";
import { companyOptions } from "@/server/services/master/companies";
import { IMPORT_NOTES, templateHeaders } from "@/server/services/master/import-rows";

export const metadata: Metadata = { title: "Import customers" };

export default function ImportCustomersPage() {
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/customers">Customers</BackLink>
      <PageHeader
        title="Import customers"
        description="Add many customers, with opening balances per company, from an Excel or CSV file."
      />
      <Panel />
    </RequirePermission>
  );
}

async function Panel() {
  const ctx = await requireTenantContext("masterData.manage");
  const companies = await companyOptions(ctx);
  return (
    <ImportPanel
      kind="customers"
      templateHeaders={templateHeaders(
        "customers",
        companies.map((c) => c.name),
      )}
      notes={IMPORT_NOTES.customers}
    />
  );
}
