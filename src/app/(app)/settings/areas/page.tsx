import type { Metadata } from "next";

import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { EditLink, LinkButton, StatusBadge } from "@/components/master/page-helpers";
import { filterParam, listParamsSchema } from "@/lib/list-params";
import { requireTenantContext } from "@/server/auth/session";
import { listAreas } from "@/server/services/master/areas";
import { warehouseOptions } from "@/server/services/master/warehouses";

export const metadata: Metadata = { title: "Areas / routes" };

export default function AreasPage({ searchParams }: PageProps<"/settings/areas">) {
  return (
    <RequirePermission permission="masterData.manage">
      <BackLink href="/settings">Settings</BackLink>
      <PageHeader
        title="Areas / routes"
        description="Group customers for delivery. Each customer's visiting order is set on the customer."
        actions={<LinkButton href="/settings/areas/new">New area</LinkButton>}
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
  const [list, warehouses] = await Promise.all([listAreas(ctx, params, sp), warehouseOptions(ctx)]);
  return (
    <>
      <Notice notice={sp.notice} />
      <ListToolbar
        basePath="/settings/areas"
        params={params}
        searchPlaceholder="Area name"
        filters={[
          {
            name: "warehouseId",
            label: "Warehouse",
            value: filterParam(sp, "warehouseId"),
            options: warehouses.map((w) => ({ value: w.id, label: w.name })),
          },
        ]}
      />
      <DataTable>
        <thead>
          <tr>
            <Th>Area</Th>
            <Th>Warehouse</Th>
            <Th className="text-right">Order</Th>
            <Th className="text-right">Customers</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <EmptyRow colSpan={5}>No areas match these filters.</EmptyRow>
          ) : null}
          {list.rows.map((a) => (
            <tr key={a.id}>
              <Td>
                <EditLink href={`/settings/areas/${a.id}`} label={a.name} />
              </Td>
              <Td>{a.warehouse.name}</Td>
              <Td className="text-right tabular-nums">{a.sortOrder}</Td>
              <Td className="text-right tabular-nums">{a._count.customers}</Td>
              <Td>
                <StatusBadge isActive={a.isActive} />
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pagination
        basePath="/settings/areas"
        searchParams={sp}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </>
  );
}
