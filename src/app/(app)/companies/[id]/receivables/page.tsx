import type { Metadata } from "next";
import Link from "next/link";

import { RequirePermission } from "@/components/layout/no-access";
import { orNotFound } from "@/components/master/page-helpers";
import { Letterhead, PrintStyles, PrintToolbar } from "@/components/print/print-frame";
import { StatementRangeForm } from "@/components/print/range-form";
import { Button } from "@/components/ui/button";
import { businessToday, formatDate, toDateInput } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { statementPageCss } from "@/lib/print";
import { requireTenantContext } from "@/server/auth/session";
import { defaultLedgerRange, parseDateRange } from "@/server/services/purchasing/filters";
import { getPrintProfile } from "@/server/services/settings";
import { getCompanyReceivables } from "@/server/services/statements";

export const metadata: Metadata = { title: "Customer balances" };

/** Company, all customers (SPEC §8): what each customer owes for this company's products. */
export default function CompanyReceivablesPage(props: PageProps<"/companies/[id]/receivables">) {
  return (
    <RequirePermission permission="ledgers.view">
      <Receivables {...props} />
    </RequirePermission>
  );
}

async function Receivables({ params, searchParams }: PageProps<"/companies/[id]/receivables">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const parsed = parseDateRange(sp);
  const range = parsed.from || parsed.to ? parsed : defaultLedgerRange(businessToday());
  const ctx = await requireTenantContext("ledgers.view");
  const [r, profile] = await Promise.all([
    orNotFound(getCompanyReceivables(ctx, id, range)),
    getPrintProfile(ctx),
  ]);
  const query = new URLSearchParams({
    ...(range.from ? { from: toDateInput(range.from) } : {}),
    ...(range.to ? { to: toDateInput(range.to) } : {}),
  }).toString();
  const cell = "border-b border-black/40 px-[0.3em] py-[0.15em] align-top";
  const num = `${cell} text-right tabular-nums whitespace-nowrap`;
  const head = "border-y border-black px-[0.3em] py-[0.2em] font-semibold";

  return (
    <div className="print-root">
      <PrintStyles css={statementPageCss(profile.print)} />
      <PrintToolbar
        back={{ href: `/companies/${id}/ledger`, label: `${r.company.name} ledger` }}
        hint="Prints on A4"
      >
        <Button asChild variant="outline" size="sm">
          <a href={`/companies/${id}/receivables/export?${query}`}>Download Excel</a>
        </Button>
      </PrintToolbar>
      <StatementRangeForm range={range} />
      <article className="mx-auto max-w-[210mm] space-y-[0.8em] bg-white leading-snug text-black">
        <Letterhead
          business={profile.business}
          right={
            <>
              <p className="text-[1.15em] font-bold">Customer balances · {r.company.name}</p>
              <p>
                {range.from ? formatDate(range.from) : "Start"} –{" "}
                {range.to ? formatDate(range.to) : "today"}
              </p>
            </>
          }
        />
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={`${head} text-left`}>Customer</th>
              <th className={`${head} text-left`}>Area</th>
              <th className={`${head} text-right`}>Opening</th>
              <th className={`${head} text-right`}>Bills (+)</th>
              <th className={`${head} text-right`}>Received (−)</th>
              <th className={`${head} text-right`}>Owes</th>
            </tr>
          </thead>
          <tbody>
            {r.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className={`${cell} text-center`}>
                  No customer owes anything for {r.company.name}.
                </td>
              </tr>
            ) : null}
            {r.rows.map((x) => (
              <tr key={x.customerId} className="break-inside-avoid">
                <td className={cell}>
                  <Link
                    href={`/customers/${x.customerId}/statement?companyId=${id}&${query}`}
                    className="underline-offset-4 hover:underline print:no-underline"
                  >
                    {x.name}
                  </Link>
                  {x.shopName ? <div>{x.shopName}</div> : null}
                </td>
                <td className={cell}>{x.areaName ?? ""}</td>
                <td className={num}>{formatMoney(x.opening)}</td>
                <td className={num}>{x.debit.isZero() ? "" : formatMoney(x.debit)}</td>
                <td className={num}>{x.credit.isZero() ? "" : formatMoney(x.credit)}</td>
                <td className={`${num} font-semibold`}>{formatMoney(x.closing)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td colSpan={2} className="border-t border-black px-[0.3em] py-[0.2em]">
                Total ({r.rows.length} customers)
              </td>
              <td className="border-t border-black px-[0.3em] py-[0.2em] text-right tabular-nums">
                {formatMoney(r.totals.opening)}
              </td>
              <td className="border-t border-black px-[0.3em] py-[0.2em] text-right tabular-nums">
                {formatMoney(r.totals.debit)}
              </td>
              <td className="border-t border-black px-[0.3em] py-[0.2em] text-right tabular-nums">
                {formatMoney(r.totals.credit)}
              </td>
              <td className="border-t border-black px-[0.3em] py-[0.2em] text-right tabular-nums">
                {formatMoney(r.totals.closing)}
              </td>
            </tr>
          </tbody>
        </table>
        <p>A negative amount is an advance the customer has paid.</p>
      </article>
    </div>
  );
}
