import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { RequirePermission } from "@/components/layout/no-access";
import { PageHeader } from "@/components/layout/page-header";
import { formatMoney } from "@/lib/format";
import { listParamsSchema } from "@/lib/list-params";
import { requireTenantContext } from "@/server/auth/session";
import { listCompanies } from "@/server/services/master/companies";
import { listCustomers } from "@/server/services/master/customers";

export const metadata: Metadata = { title: "Ledgers" };

// One place to open any ledger: every company's ledger, and each customer's statement (search for
// the customer). Balances are the same as on the Customers and Companies lists.

export default function LedgersPage(props: PageProps<"/ledgers">) {
  return (
    <RequirePermission permission="ledgers.view">
      <PageHeader
        title="Ledgers"
        description="Open a company's ledger or a customer's statement."
      />
      <Ledgers {...props} />
    </RequirePermission>
  );
}

async function Ledgers({ searchParams }: PageProps<"/ledgers">) {
  const sp = await searchParams;
  const params = listParamsSchema.parse(sp);
  const ctx = await requireTenantContext("ledgers.view");
  const [customers, companies] = await Promise.all([
    listCustomers(ctx, params, sp),
    listCompanies(ctx, listParamsSchema.parse({ status: params.status }), {}),
  ]);

  return (
    <div className="space-y-8">
      <section aria-labelledby="company-ledgers">
        <h2 id="company-ledgers" className="mb-2 text-lg font-semibold">
          Companies
        </h2>
        <DataTable>
          <thead>
            <tr>
              <Th>Company</Th>
              <Th className="text-right">We owe</Th>
              <Th>Open</Th>
            </tr>
          </thead>
          <tbody>
            {companies.rows.length === 0 ? <EmptyRow colSpan={3}>No companies.</EmptyRow> : null}
            {companies.rows.map((c) => (
              <tr key={c.id}>
                <Td className="font-medium">{c.name}</Td>
                <Td className="text-right tabular-nums">{formatMoney(c.payable ?? 0)}</Td>
                <Td className="whitespace-nowrap">
                  <Link href={`/companies/${c.id}/ledger`} className="underline underline-offset-4">
                    Ledger
                  </Link>
                  <span className="text-muted-foreground"> · </span>
                  <Link
                    href={`/companies/${c.id}/receivables`}
                    className="underline underline-offset-4"
                  >
                    Customers owe
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </section>

      <section aria-labelledby="customer-ledgers">
        <h2 id="customer-ledgers" className="mb-2 text-lg font-semibold">
          Customers
        </h2>
        <ListToolbar
          basePath="/ledgers"
          params={params}
          searchPlaceholder="Customer name, shop, phone or area"
        />
        <DataTable>
          <thead>
            <tr>
              <Th>Customer</Th>
              <Th>Area</Th>
              <Th>Phone</Th>
              <Th className="text-right">Balance</Th>
              <Th>Open</Th>
            </tr>
          </thead>
          <tbody>
            {customers.rows.length === 0 ? (
              <EmptyRow colSpan={5}>No customers match this search.</EmptyRow>
            ) : null}
            {customers.rows.map((c) => (
              <tr key={c.id}>
                <Td>
                  <span className="font-medium">{c.name}</span>
                  {c.shopName ? <div className="text-muted-foreground">{c.shopName}</div> : null}
                </Td>
                <Td>{c.area?.name ?? "—"}</Td>
                <Td className="whitespace-nowrap">{c.phone ?? "—"}</Td>
                <Td className="text-right tabular-nums">{formatMoney(c.balance)}</Td>
                <Td>
                  <Link
                    href={`/customers/${c.id}/statement`}
                    className="underline underline-offset-4"
                  >
                    Statement
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        <Pagination
          basePath="/ledgers"
          searchParams={sp}
          page={customers.page}
          pageCount={customers.pageCount}
          total={customers.total}
        />
      </section>
    </div>
  );
}
