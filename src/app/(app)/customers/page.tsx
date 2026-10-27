import type { Metadata } from "next";
import Link from "next/link";

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
import { areaOptions } from "@/server/services/master/areas";
import { listCustomers } from "@/server/services/master/customers";

import { CUSTOMER_TYPE_OPTIONS, customerTypeLabel } from "./customer-fields";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: PageProps<"/customers">) {
  const sp = await searchParams;
  const params = listParamsSchema.parse(sp);
  const ctx = await requireTenantContext();
  const [list, areas] = await Promise.all([listCustomers(ctx, params, sp), areaOptions(ctx)]);
  const canEdit = can(ctx.user.role, "masterData.manage");
  const canSeeLedger = can(ctx.user.role, "ledgers.view");

  return (
    <>
      <PageHeader
        title="Customers"
        description="Retailers, wholesalers, dealers and bike suppliers. Balance is what each customer owes now."
        actions={
          canEdit ? (
            <>
              <LinkButton href="/customers/import" variant="outline">
                Import
              </LinkButton>
              <LinkButton href="/customers/new">New customer</LinkButton>
            </>
          ) : null
        }
      />
      <Notice notice={sp.notice} />
      <ListToolbar
        basePath="/customers"
        params={params}
        searchPlaceholder="Name, shop, phone or address"
        filters={[
          {
            name: "areaId",
            label: "Area",
            value: filterParam(sp, "areaId"),
            options: areas.map((a) => ({ value: a.id, label: `${a.name} · ${a.warehouse.name}` })),
          },
          {
            name: "type",
            label: "Type",
            value: filterParam(sp, "type"),
            options: CUSTOMER_TYPE_OPTIONS,
          },
        ]}
      />
      <DataTable>
        <thead>
          <tr>
            <Th>Customer</Th>
            <Th>Type</Th>
            <Th>Area</Th>
            <Th>Phone</Th>
            <Th className="text-right">Credit limit</Th>
            <Th className="text-right">Balance</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <EmptyRow colSpan={7}>No customers match these filters.</EmptyRow>
          ) : null}
          {list.rows.map((c) => (
            <tr key={c.id}>
              <Td>
                {canEdit ? (
                  <EditLink href={`/customers/${c.id}`} label={c.name} />
                ) : (
                  <span className="font-medium">{c.name}</span>
                )}
                {c.isFlagged ? (
                  <span
                    className="text-destructive ml-2 text-xs font-medium"
                    title={c.flagReason ?? ""}
                  >
                    Flagged
                  </span>
                ) : null}
                {c.shopName ? <div className="text-muted-foreground">{c.shopName}</div> : null}
              </Td>
              <Td>{customerTypeLabel(c.type)}</Td>
              <Td>
                {c.area?.name ?? "—"}
                {c.routeSequence !== null ? (
                  <span className="text-muted-foreground"> #{c.routeSequence}</span>
                ) : null}
              </Td>
              <Td className="whitespace-nowrap">{c.phone ?? "—"}</Td>
              <Td className="text-right tabular-nums">
                {c.creditLimit === null ? "No limit" : formatMoney(c.creditLimit)}
              </Td>
              <Td className="text-right font-medium tabular-nums">
                {canSeeLedger ? (
                  <Link
                    href={`/customers/${c.id}/statement`}
                    className="underline decoration-dotted underline-offset-4 hover:decoration-solid"
                    title="Open statement (ledger)"
                  >
                    {formatMoney(c.balance)}
                  </Link>
                ) : (
                  formatMoney(c.balance)
                )}
              </Td>
              <Td>
                <StatusBadge isActive={c.isActive} />
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pagination
        basePath="/customers"
        searchParams={sp}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </>
  );
}
