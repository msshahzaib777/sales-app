import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NoAccess, RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { ImportPanel } from "@/components/master/import-panel";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { IMPORT_NOTES } from "@/server/services/master/import-rows";

import { IMPORTS } from "../import-kinds";

export const metadata: Metadata = { title: "Import" };

export default function ImportKindPage({ params }: PageProps<"/import/[kind]">) {
  return (
    <RequirePermission permission="masterData.manage">
      <Panel params={params} />
    </RequirePermission>
  );
}

async function Panel({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const entry = IMPORTS.find((i) => i.kind === kind);
  if (!entry) notFound();
  const ctx = await requireTenantContext("masterData.manage");
  if (entry.permission && !can(ctx.user.role, entry.permission)) return <NoAccess />;
  return (
    <>
      <BackLink href="/import">Import from Excel</BackLink>
      <PageHeader title={`Import ${entry.title.toLowerCase()}`} description={entry.description} />
      <ImportPanel kind={entry.kind} notes={IMPORT_NOTES[entry.kind]} />
    </>
  );
}
