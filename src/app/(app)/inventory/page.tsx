import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { PrintButton } from "@/components/layout/print-button";
import { Badge } from "@/components/ui/badge";
import { filterParam, listParamsSchema } from "@/lib/list-params";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import { listStock } from "@/server/services/inventory";
import { companyOptions } from "@/server/services/master/companies";
import { warehouseOptions } from "@/server/services/master/warehouses";

export const metadata: Metadata = { title: "Inventory" };

export default async function InventoryPage({ searchParams }: PageProps<"/inventory">) {
  const sp = await searchParams;
  const { q, page } = listParamsSchema.parse(sp);
  const ctx = await requireTenantContext("operations.manage");
  const [list, warehouses, companies] = await Promise.all([
    listStock(ctx, {
      q,
      page,
      warehouseId: filterParam(sp, "warehouseId"),
      companyId: filterParam(sp, "companyId"),
      low: filterParam(sp, "level") === "low",
    }),
    warehouseOptions(ctx),
    companyOptions(ctx),
  ]);
  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock per product, rebuilt from every stock movement. Available = on hand − reserved for booked and planned orders."
        actions={<PrintButton />}
      />
      <ListToolbar
        basePath="/inventory"
        params={{ q, status: "all" }}
        showStatus={false}
        searchPlaceholder="Product code or name"
        filters={[
          {
            name: "warehouseId",
            label: "Warehouse",
            value: filterParam(sp, "warehouseId"),
            options: warehouses.map((w) => ({ value: w.id, label: w.name })),
          },
          {
            name: "companyId",
            label: "Company",
            value: filterParam(sp, "companyId"),
            options: companies.map((c) => ({ value: c.id, label: c.name })),
          },
          {
            name: "level",
            label: "Level",
            value: filterParam(sp, "level"),
            options: [{ value: "low", label: "Below minimum" }],
          },
        ]}
      />
      <p className="mb-3 text-sm">
        {list.total} {list.total === 1 ? "product" : "products"} · on hand{" "}
        <strong>{formatDozens(list.totals.onHand)}</strong> · reserved{" "}
        {formatDozens(list.totals.reserved)} · damaged {formatDozens(list.totals.damaged)}
        {list.totals.low ? (
          <>
            {" "}
            ·{" "}
            <Link
              href="/inventory?level=low"
              className="text-destructive font-medium underline underline-offset-4"
            >
              {list.totals.low} below minimum
            </Link>
          </>
        ) : null}
      </p>
      <DataTable>
        <thead>
          <tr>
            <Th>Code</Th>
            <Th>Product</Th>
            <Th>Company</Th>
            <Th className="text-right">On hand</Th>
            <Th className="text-right">Reserved</Th>
            <Th className="text-right">Available</Th>
            <Th className="text-right">Minimum</Th>
            <Th className="text-right">Damaged</Th>
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <EmptyRow colSpan={8}>No products match these filters.</EmptyRow>
          ) : null}
          {list.rows.map((r) => (
            <tr key={r.id}>
              <Td className="font-mono">{r.code}</Td>
              <Td>
                <Link href={`/inventory/${r.id}`} className="underline-offset-4 hover:underline">
                  {r.name}
                </Link>
              </Td>
              <Td>
                {r.companyName}
                <div className="text-muted-foreground">{r.warehouseName}</div>
              </Td>
              <Td className="text-right tabular-nums">{formatDozens(r.onHand)}</Td>
              <Td className="text-right tabular-nums">
                {r.reserved ? formatDozens(r.reserved) : ""}
              </Td>
              <Td className="text-right font-medium tabular-nums">
                {formatDozens(r.available)}
                {r.low ? (
                  <Badge variant="destructive" className="ml-2">
                    Low
                  </Badge>
                ) : null}
              </Td>
              <Td className="text-right tabular-nums">
                {r.minStockLevel ? formatDozens(r.minStockLevel) : ""}
              </Td>
              <Td className="text-right tabular-nums">
                {r.damaged ? formatDozens(r.damaged) : ""}
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pagination
        basePath="/inventory"
        searchParams={sp}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </>
  );
}
