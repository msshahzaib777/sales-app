import type { Metadata } from "next";

import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { EditLink, LinkButton, StatusBadge } from "@/components/master/page-helpers";
import { formatDiscount, formatMoney } from "@/lib/format";
import { filterParam, listParamsSchema } from "@/lib/list-params";
import { formatDozens } from "@/lib/units";
import { can } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { companyOptions } from "@/server/services/master/companies";
import { listProducts } from "@/server/services/master/products";

export const metadata: Metadata = { title: "Products" };

export default async function ProductsPage({ searchParams }: PageProps<"/products">) {
  const sp = await searchParams;
  const params = listParamsSchema.parse(sp);
  const ctx = await requireTenantContext();
  const [list, companies] = await Promise.all([listProducts(ctx, params, sp), companyOptions(ctx)]);
  const canEdit = can(ctx.user.role, "masterData.manage");
  const showCost = can(ctx.user.role, "financials.view");

  return (
    <>
      <PageHeader
        title="Products"
        description="Rates are per dozen in PKR. The company discount is applied automatically on bills."
        actions={
          canEdit ? (
            <>
              <LinkButton href="/products/import" variant="outline">
                Import
              </LinkButton>
              <LinkButton href="/products/new">New product</LinkButton>
            </>
          ) : null
        }
      />
      <Notice notice={sp.notice} />
      <ListToolbar
        basePath="/products"
        params={params}
        searchPlaceholder="Name or code"
        filters={[
          {
            name: "companyId",
            label: "Company",
            value: filterParam(sp, "companyId"),
            options: companies.map((c) => ({ value: c.id, label: c.name })),
          },
        ]}
      />
      <DataTable>
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Product</Th>
            <Th>Company</Th>
            {showCost ? <Th className="text-right">Purchase rate</Th> : null}
            <Th className="text-right">Sale rate</Th>
            <Th>Discount</Th>
            <Th className="text-right">Min. stock</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <EmptyRow colSpan={8}>No products match these filters.</EmptyRow>
          ) : null}
          {list.rows.map((p) => (
            <tr key={p.id}>
              <Td className="font-mono">{p.code}</Td>
              <Td>
                {canEdit ? (
                  <EditLink href={`/products/${p.id}`} label={p.name} />
                ) : (
                  <span className="font-medium">{p.name}</span>
                )}
              </Td>
              <Td>{p.company.name}</Td>
              {showCost ? (
                <Td className="text-right tabular-nums">{formatMoney(p.purchaseRate)}</Td>
              ) : null}
              <Td className="text-right tabular-nums">{formatMoney(p.saleRate)}</Td>
              <Td>
                {formatDiscount(p)}
                {p.discountTiers.map((t) => (
                  <div key={t.id} className="text-muted-foreground text-xs">
                    from {formatDozens(t.minQuantity)}: {formatDiscount(t)}
                  </div>
                ))}
              </Td>
              <Td className="text-right tabular-nums">
                {p.minStockLevel ? formatDozens(p.minStockLevel) : "—"}
              </Td>
              <Td>
                <StatusBadge isActive={p.isActive} />
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pagination
        basePath="/products"
        searchParams={sp}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </>
  );
}
