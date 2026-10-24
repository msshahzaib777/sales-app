import type { Metadata } from "next";

import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { EditLink, LinkButton, StatusBadge } from "@/components/master/page-helpers";
import { listParamsSchema } from "@/lib/list-params";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import { listBikes } from "@/server/services/master/bikes";

export const metadata: Metadata = { title: "Delivery bikes" };

export default function BikesPage({ searchParams }: PageProps<"/settings/bikes">) {
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/settings">Settings</BackLink>
      <PageHeader
        title="Delivery bikes"
        description="Capacity is used for load planning."
        actions={<LinkButton href="/settings/bikes/new">New bike</LinkButton>}
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
  const list = await listBikes(ctx, params);
  return (
    <>
      <Notice notice={sp.notice} />
      <ListToolbar
        basePath="/settings/bikes"
        params={params}
        searchPlaceholder="Bike name or number"
      />
      <DataTable>
        <thead>
          <tr>
            <Th>Bike</Th>
            <Th className="text-right">Capacity</Th>
            <Th>Warehouse</Th>
            <Th>Driver</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <EmptyRow colSpan={5}>No bikes match these filters.</EmptyRow>
          ) : null}
          {list.rows.map((b) => (
            <tr key={b.id}>
              <Td>
                <EditLink href={`/settings/bikes/${b.id}`} label={b.name} />
              </Td>
              <Td className="text-right tabular-nums">{formatDozens(b.capacity)}</Td>
              <Td>{b.warehouse?.name ?? "Any"}</Td>
              <Td>{b.driver?.name ?? "—"}</Td>
              <Td>
                <StatusBadge isActive={b.isActive} />
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pagination
        basePath="/settings/bikes"
        searchParams={sp}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </>
  );
}
