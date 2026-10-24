import type { Metadata } from "next";
import Link from "next/link";

import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { PrintButton } from "@/components/layout/print-button";
import { LinkButton, orNotFound } from "@/components/master/page-helpers";
import { MoneyPage } from "@/components/purchasing/money-guard";
import { BillStatusBadge } from "@/components/purchasing/status-badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { businessToday, formatDate, toDateInput } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { requireTenantContext } from "@/server/auth/session";
import { getCompanyLedger } from "@/server/services/purchasing/company-ledger";
import { defaultLedgerRange, parseDateRange } from "@/server/services/purchasing/filters";

export const metadata: Metadata = { title: "Company ledger" };

export default function CompanyLedgerPage({
  params,
  searchParams,
}: PageProps<"/companies/[id]/ledger">) {
  return (
    <MoneyPage>
      <BackLink href="/companies">Companies</BackLink>
      <Ledger params={params} searchParams={searchParams} />
    </MoneyPage>
  );
}

function Amount({ value, label }: { value: { toString(): string }; label: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{formatMoney(value)}</p>
    </div>
  );
}

async function Ledger({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const parsed = parseDateRange(sp);
  const range = parsed.from || parsed.to ? parsed : defaultLedgerRange(businessToday());
  const ctx = await requireTenantContext("ledgers.view");
  const ledger = await orNotFound(getCompanyLedger(ctx, id, range));
  const { company, summary } = ledger;
  const query = new URLSearchParams({
    ...(range.from ? { from: toDateInput(range.from) } : {}),
    ...(range.to ? { to: toDateInput(range.to) } : {}),
  }).toString();

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${company.name} — ledger`}
        description={`${company.warehouse.name} · payment terms ${company.paymentTermsDays} days${company.orderBookerName ? ` · booker ${company.orderBookerName} ${company.orderBookerPhone ?? ""}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            <LinkButton href={`/purchases/payments/new?companyId=${company.id}`}>
              New payment
            </LinkButton>
            <PrintButton />
            <LinkButton href={`/companies/${company.id}/statement?${query}`} variant="outline">
              Printable statement
            </LinkButton>
            <LinkButton href={`/companies/${company.id}/receivables?${query}`} variant="outline">
              Customer balances
            </LinkButton>
            <Button asChild variant="outline">
              <a href={`/companies/${company.id}/ledger/export?${query}`}>Download Excel</a>
            </Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Amount label="We owe now" value={summary.payableNow} />
        <Amount label="Open bills" value={summary.openBills} />
        <Amount
          label={`Overdue (${summary.overdueCount} ${summary.overdueCount === 1 ? "bill" : "bills"})`}
          value={summary.overdue}
        />
        <Amount label="Claims waiting for next bill" value={summary.pendingClaims} />
      </div>

      <form method="get" className="flex flex-wrap items-end gap-2 print:hidden">
        <div className="space-y-1">
          <label htmlFor="from" className="text-muted-foreground text-xs font-medium">
            From
          </label>
          <Input
            id="from"
            name="from"
            type="date"
            defaultValue={range.from ? toDateInput(range.from) : ""}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="to" className="text-muted-foreground text-xs font-medium">
            To
          </label>
          <Input
            id="to"
            name="to"
            type="date"
            defaultValue={range.to ? toDateInput(range.to) : ""}
            className="w-40"
          />
        </div>
        <Button type="submit" variant="secondary">
          Show
        </Button>
      </form>

      <section aria-labelledby="ledger-heading">
        <h2 id="ledger-heading" className="mb-2 font-medium">
          Ledger {range.from ? formatDate(range.from) : "start"} –{" "}
          {range.to ? formatDate(range.to) : "today"}
        </h2>
        <DataTable>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Entry</Th>
              <Th>Details</Th>
              <Th className="text-right">Bills (+)</Th>
              <Th className="text-right">Paid / credit (−)</Th>
              <Th className="text-right">Balance (we owe)</Th>
            </tr>
          </thead>
          <tbody>
            <tr className="text-muted-foreground">
              <Td>{range.from ? formatDate(range.from) : ""}</Td>
              <Td>Opening</Td>
              <Td>Balance brought forward</Td>
              <Td />
              <Td />
              <Td className="text-right tabular-nums">{formatMoney(ledger.opening)}</Td>
            </tr>
            {ledger.rows.length === 0 ? (
              <EmptyRow colSpan={6}>No entries in this period.</EmptyRow>
            ) : null}
            {ledger.rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">{formatDate(r.entryDate)}</Td>
                <Td>{r.typeLabel}</Td>
                <Td>
                  {r.href ? (
                    <Link href={r.href} className="underline-offset-4 hover:underline">
                      {r.description}
                    </Link>
                  ) : (
                    r.description
                  )}
                </Td>
                <Td className="text-right tabular-nums">
                  {r.credit.isZero() ? "" : formatMoney(r.credit)}
                </Td>
                <Td className="text-right tabular-nums">
                  {r.debit.isZero() ? "" : formatMoney(r.debit)}
                </Td>
                <Td className="text-right font-medium tabular-nums">{formatMoney(r.balance)}</Td>
              </tr>
            ))}
            <tr className="font-medium">
              <Td>{range.to ? formatDate(range.to) : ""}</Td>
              <Td>Closing</Td>
              <Td />
              <Td />
              <Td />
              <Td className="text-right tabular-nums">{formatMoney(ledger.closing)}</Td>
            </tr>
          </tbody>
        </DataTable>
        <p className="text-muted-foreground mt-2 text-xs">
          A negative balance means the company owes you (advance or claims).
        </p>
      </section>

      <section aria-labelledby="bills-heading">
        <h2 id="bills-heading" className="mb-2 font-medium">
          Bills
        </h2>
        <DataTable>
          <thead>
            <tr>
              <Th>Bill</Th>
              <Th>Billed</Th>
              <Th>Due</Th>
              <Th className="text-right">Amount</Th>
              <Th className="text-right">Paid</Th>
              <Th className="text-right">Outstanding</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {ledger.bills.length === 0 ? <EmptyRow colSpan={7}>No bills yet.</EmptyRow> : null}
            {ledger.bills.map((b) => (
              <tr key={b.id}>
                <Td>
                  <Link
                    href={`/purchases/bills/${b.id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    #{b.number}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap">{formatDate(b.billDate)}</Td>
                <Td className="whitespace-nowrap">{formatDate(b.dueDate)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(b.netAmount)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(b.paid)}</Td>
                <Td className="text-right tabular-nums">{formatMoney(b.outstanding)}</Td>
                <Td>
                  <BillStatusBadge state={b} />
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </section>
    </div>
  );
}
