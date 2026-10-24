import type { Metadata } from "next";
import Link from "next/link";

import { ReasonAction } from "@/components/form/reason-action";
import { PrintButton } from "@/components/layout/print-button";
import { RequirePermission } from "@/components/layout/no-access";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { Notice } from "@/components/master/notice";
import { LinkButton } from "@/components/master/page-helpers";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/dates";
import { PAYMENT_METHOD_LABEL } from "@/lib/expenses";
import { formatMoney } from "@/lib/format";
import { filterParam, listParamsSchema } from "@/lib/list-params";
import { requireTenantContext } from "@/server/auth/session";
import { reverseExpenseAction } from "@/server/expense-actions";
import { expenseFormOptions, listExpenses } from "@/server/services/expenses";
import { parseDateRange } from "@/server/services/purchasing/filters";

export const metadata: Metadata = { title: "Expenses" };

export default function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  return (
    <RequirePermission permission="expenses.manage">
      <PageHeader
        title="Expenses"
        description="Money spent: rent, salary, petrol and the rest, by category, bike and trip."
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <LinkButton href="/expenses/categories" variant="outline">
              Categories
            </LinkButton>
            <LinkButton href="/expenses/new">Add expense</LinkButton>
          </div>
        }
      />
      <Expenses searchParams={searchParams} />
    </RequirePermission>
  );
}

const FILTER_KEYS = [
  "q",
  "categoryId",
  "method",
  "warehouseId",
  "bikeId",
  "expenseStatus",
  "from",
  "to",
];

async function Expenses({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const { q, page } = listParamsSchema.parse(sp);
  const ctx = await requireTenantContext("expenses.manage");
  const filters = {
    q,
    categoryId: filterParam(sp, "categoryId"),
    method: filterParam(sp, "method"),
    warehouseId: filterParam(sp, "warehouseId"),
    bikeId: filterParam(sp, "bikeId"),
    status: filterParam(sp, "expenseStatus"),
    ...parseDateRange(sp),
  };
  const [list, options] = await Promise.all([
    listExpenses(ctx, { ...filters, page }),
    expenseFormOptions(ctx),
  ]);
  const exportQuery = new URLSearchParams(
    FILTER_KEYS.flatMap((k) => {
      const v = filterParam(sp, k);
      return v ? [[k, v]] : [];
    }),
  ).toString();

  return (
    <>
      <Notice notice={sp.notice} />
      <div className="print:hidden">
        <ListToolbar
          basePath="/expenses"
          params={{ q, status: "all" }}
          showStatus={false}
          searchPlaceholder="Note, paid to, category, bike, staff or no."
          dateRange={{ from: filterParam(sp, "from"), to: filterParam(sp, "to") }}
          filters={[
            {
              name: "categoryId",
              label: "Category",
              value: filters.categoryId,
              options: options.categories.map((c) => ({ value: c.id, label: c.name })),
            },
            {
              name: "method",
              label: "Paid by",
              value: filters.method,
              options: Object.entries(PAYMENT_METHOD_LABEL).map(([value, label]) => ({
                value,
                label,
              })),
            },
            {
              name: "warehouseId",
              label: "Warehouse",
              value: filters.warehouseId,
              options: options.warehouses.map((w) => ({ value: w.id, label: w.name })),
            },
            {
              name: "bikeId",
              label: "Bike",
              value: filters.bikeId,
              options: options.bikes.map((b) => ({ value: b.id, label: b.name })),
            },
            {
              name: "expenseStatus",
              label: "Status",
              value: filters.status,
              options: [
                { value: "POSTED", label: "Posted" },
                { value: "REVERSED", label: "Reversed" },
              ],
            },
          ]}
        />
      </div>

      <section aria-labelledby="totals-heading" className="mb-4 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="totals-heading" className="font-medium">
            Total <span className="tabular-nums">{formatMoney(list.totalAmount)}</span>
            <span className="text-muted-foreground text-sm font-normal">
              {" "}
              · {list.total} expense{list.total === 1 ? "" : "s"}
              {filters.from || filters.to
                ? ` · ${filters.from ? formatDate(filters.from) : "…"} – ${filters.to ? formatDate(filters.to) : "…"}`
                : ""}
            </span>
          </h2>
          <div className="flex gap-2 print:hidden">
            <Button asChild variant="outline" size="sm">
              <a href={`/expenses/export?${exportQuery}`}>Download Excel</a>
            </Button>
            <PrintButton />
          </div>
        </div>
        {list.byCategory.length > 0 ? (
          <ul className="flex flex-wrap gap-2 text-sm">
            {list.byCategory.map((c) => (
              <li key={c.categoryId} className="rounded-md border px-2 py-1">
                {c.name} <strong className="tabular-nums">{formatMoney(c.amount)}</strong>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <DataTable>
        <thead>
          <tr>
            <Th>No.</Th>
            <Th>Date</Th>
            <Th>Category</Th>
            <Th>Details</Th>
            <Th>For</Th>
            <Th>Paid by</Th>
            <Th className="text-right">Amount</Th>
            <Th>
              <span className="sr-only">Actions</span>
            </Th>
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <EmptyRow colSpan={8}>
              No expenses match these filters.{" "}
              <Link href="/expenses/new" className="underline">
                Add one
              </Link>
              .
            </EmptyRow>
          ) : null}
          {list.rows.map((e) => {
            const reversed = e.status === "REVERSED";
            return (
              <tr key={e.id} className={reversed ? "text-muted-foreground" : undefined}>
                <Td className="font-medium">#{e.number}</Td>
                <Td className="whitespace-nowrap">{formatDate(e.expenseDate)}</Td>
                <Td>{e.category.name}</Td>
                <Td>
                  {e.paidTo ? <div>{e.paidTo}</div> : null}
                  {e.note ? <div className="text-muted-foreground">{e.note}</div> : null}
                  {reversed ? (
                    <div className="text-xs">
                      <Badge variant="outline">Reversed</Badge> {e.reversalReason}
                    </div>
                  ) : null}
                </Td>
                <Td>
                  {[
                    e.warehouse?.name,
                    e.bike?.name,
                    e.trip ? `Trip #${e.trip.number}` : null,
                    e.staff?.name,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Td>
                <Td>{PAYMENT_METHOD_LABEL[e.method]}</Td>
                <Td className={`text-right tabular-nums ${reversed ? "line-through" : ""}`}>
                  {formatMoney(e.amount)}
                </Td>
                <Td className="print:hidden">
                  {reversed ? null : (
                    <ReasonAction
                      action={reverseExpenseAction.bind(null, e.id)}
                      label="Reverse"
                      description={`Reverse expense #${e.number}? It stays in the list, marked reversed, and no longer counts in the totals.`}
                    />
                  )}
                </Td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
      <div className="print:hidden">
        <Pagination
          basePath="/expenses"
          searchParams={sp}
          page={list.page}
          pageCount={list.pageCount}
          total={list.total}
        />
      </div>
    </>
  );
}
