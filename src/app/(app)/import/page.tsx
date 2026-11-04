import type { Metadata } from "next";
import Link from "next/link";

import { RequirePermission } from "@/components/layout/no-access";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";

import { IMPORTS } from "./import-kinds";

export const metadata: Metadata = { title: "Import from Excel" };

export default function ImportPage() {
  return (
    <RequirePermission permission="masterData.manage">
      <PageHeader
        title="Import from Excel"
        description="Bring in your existing lists. Download a sample sheet, fill it in Excel, then upload it: you see every row checked before anything is saved."
      />
      <Imports />
    </RequirePermission>
  );
}

async function Imports() {
  const ctx = await requireTenantContext("masterData.manage");
  return (
    <ol className="max-w-3xl space-y-3">
      {IMPORTS.filter((i) => !i.permission || can(ctx.user.role, i.permission)).map((i, n) => (
        <li key={i.kind} className="space-y-2 rounded-lg border p-4">
          <h2 className="font-medium">
            {n + 1}. {i.title}
          </h2>
          <p className="text-muted-foreground text-sm">{i.description}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link href={`/import/${i.kind}`}>Import {i.title.toLowerCase()}</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={`/import/template/${i.kind}`}>Download sample sheet</a>
            </Button>
          </div>
        </li>
      ))}
      <li className="text-muted-foreground text-sm">
        Do them in this order: products need their company, and customers need their area and the
        companies of their opening balances. Warehouses are added under Settings → Warehouses.
      </li>
    </ol>
  );
}
