import type { Metadata } from "next";

import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { EditLink, LinkButton, StatusBadge } from "@/components/master/page-helpers";
import { listParamsSchema } from "@/lib/list-params";
import { requireTenantContext } from "@/server/auth/session";
import { listWarehouses } from "@/server/services/master/warehouses";

export const metadata: Metadata = { title: "Warehouses" };

export default function WarehousesPage({ searchParams }: PageProps<"/settings/warehouses">) {
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/settings">Settings</BackLink>
      <PageHeader
        title="Warehouses"
        description="Stock and companies are kept separately per warehouse."
        actions={<LinkButton href="/settings/warehouses/new">New warehouse</LinkButton>}
      />
      <List searchParams={searchParams} />
    </RequirePermission>
  );
}

async function List({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = listParamsSchema.parse(sp);
  const ctx = await requireTenantContext("masterData.manage");
  const list = await listWarehouses(ctx, params);
  return (
    <>
      <Notice notice={sp.notice} />
      <ListToolbar
        basePath="/settings/warehouses"
        params={params}
        searchPlaceholder="Name or address"
      />
      <DataTable>
        <thead>
          <tr>
            <Th>Warehouse</Th>
            <Th>Address</Th>
            <Th className="text-right">Companies</Th>
            <Th className="text-right">Areas</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <EmptyRow colSpan={5}>No warehouses match these filters.</EmptyRow>
          ) : null}
          {list.rows.map((w) => (
            <tr key={w.id}>
              <Td>
                <EditLink href={`/settings/warehouses/${w.id}`} label={w.name} />
              </Td>
              <Td>{w.address ?? "—"}</Td>
              <Td className="text-right tabular-nums">{w._count.companies}</Td>
              <Td className="text-right tabular-nums">{w._count.areas}</Td>
              <Td>
                <StatusBadge isActive={w.isActive} />
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pagination
        basePath="/settings/warehouses"
        searchParams={sp}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </>
  );
}
