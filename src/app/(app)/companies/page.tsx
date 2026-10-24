import type { Metadata } from "next";

import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { EditLink, LinkButton, StatusBadge } from "@/components/master/page-helpers";
import { formatMoney } from "@/lib/format";
import { filterParam, listParamsSchema } from "@/lib/list-params";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { listCompanies } from "@/server/services/master/companies";
import { warehouseOptions } from "@/server/services/master/warehouses";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage({ searchParams }: PageProps<"/companies">) {
  const sp = await searchParams;
  const params = listParamsSchema.parse(sp);
  const ctx = await requireTenantContext();
  const [list, warehouses] = await Promise.all([
    listCompanies(ctx, params, sp),
    warehouseOptions(ctx),
  ]);
  const canEdit = can(ctx.user.role, "masterData.manage");
  const showPayable = can(ctx.user.role, "ledgers.view");

  return (
    <>
      <PageHeader
        title="Companies"
        description="Suppliers whose products you distribute, with their order bookers and payment terms."
        actions={canEdit ? <LinkButton href="/companies/new">New company</LinkButton> : null}
      />
      <Notice notice={sp.notice} />
      <ListToolbar
        basePath="/companies"
        params={params}
        searchPlaceholder="Company, contact or booker"
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
            <Th>Company</Th>
            <Th>Warehouse</Th>
            <Th>Order booker</Th>
            <Th className="text-right">Terms</Th>
            <Th className="text-right">Products</Th>
            {showPayable ? <Th className="text-right">Payable</Th> : null}
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <EmptyRow colSpan={7}>No companies match these filters.</EmptyRow>
          ) : null}
          {list.rows.map((c) => (
            <tr key={c.id}>
              <Td>
                {canEdit ? (
                  <EditLink href={`/companies/${c.id}`} label={c.name} />
                ) : (
                  <span className="font-medium">{c.name}</span>
                )}
                {c.contactName || c.phone ? (
                  <div className="text-muted-foreground">
                    {[c.contactName, c.phone].filter(Boolean).join(" · ")}
                  </div>
                ) : null}
              </Td>
              <Td>{c.warehouse.name}</Td>
              <Td>
                {c.orderBookerName ?? "—"}
                {c.orderBookerPhone ? (
                  <div className="text-muted-foreground whitespace-nowrap">
                    {c.orderBookerPhone}
                  </div>
                ) : null}
              </Td>
              <Td className="text-right tabular-nums">{c.paymentTermsDays} days</Td>
              <Td className="text-right tabular-nums">{c._count.products}</Td>
              {showPayable ? (
                <Td className="text-right font-medium tabular-nums">{formatMoney(c.payable)}</Td>
              ) : null}
              <Td>
                <StatusBadge isActive={c.isActive} />
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pagination
        basePath="/companies"
        searchParams={sp}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </>
  );
}
