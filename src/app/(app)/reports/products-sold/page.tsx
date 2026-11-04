import type { Metadata } from "next";
import Link from "next/link";

import { RequirePermission } from "@/components/layout/no-access";
import { Letterhead, PrintStyles, PrintToolbar } from "@/components/print/print-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { shiftPeriod } from "@/lib/analysis";
import { formatDate, toDateInput } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { statementPageCss } from "@/lib/print";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import { productsSold, type SoldPeriod, soldParams } from "@/server/services/reports/products-sold";
import { getPrintProfile } from "@/server/services/settings";

export const metadata: Metadata = { title: "Products sold" };

const DAY_MS = 86_400_000;
const th = "border-b border-black py-[0.2em] pr-[0.8em] text-left font-semibold";
const td = "border-b border-dotted border-black/60 py-[0.15em] pr-[0.8em] align-top";
const num = "text-right tabular-nums whitespace-nowrap";
const PERIODS: { value: SoldPeriod; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "custom", label: "From – to" },
];

export default function ProductsSoldPage(props: PageProps<"/reports/products-sold">) {
  return (
    <RequirePermission permission="reports.productsSold">
      <Report {...props} />
    </RequirePermission>
  );
}

/** The same period moved back (−1) or forward (+1). */
function shifted(period: SoldPeriod, date: Date, steps: number) {
  if (period === "week" || period === "month") return shiftPeriod(period, date, steps).from;
  return new Date(date.getTime() + steps * DAY_MS);
}

async function Report({ searchParams }: PageProps<"/reports/products-sold">) {
  const sp = await searchParams;
  const ctx = await requireTenantContext("reports.productsSold");
  const q = soldParams(sp);
  const [r, profile] = await Promise.all([
    productsSold(ctx, { from: q.from, to: q.to, companyId: q.companyId }),
    getPrintProfile(ctx),
  ]);
  const link = (date: Date) =>
    `/reports/products-sold?${new URLSearchParams({
      period: q.period,
      date: toDateInput(date),
      ...(q.companyId ? { companyId: q.companyId } : {}),
    })}`;
  const query = new URLSearchParams({
    period: q.period,
    date: toDateInput(q.date),
    from: toDateInput(q.from),
    to: toDateInput(q.to),
    ...(q.companyId ? { companyId: q.companyId } : {}),
  });
  const company = r.companies.find((c) => c.id === q.companyId);
  const dates =
    r.dayCount === 1 ? formatDate(r.from) : `${formatDate(r.from)} – ${formatDate(r.to)}`;

  return (
    <div className="print-root">
      <PrintStyles css={statementPageCss(profile.print)} />
      <PrintToolbar back={{ href: "/reports", label: "Reports" }} hint="Prints on A4">
        <Button asChild variant="outline" size="sm">
          <a href={`/reports/products-sold/export?${query}`}>Download Excel</a>
        </Button>
      </PrintToolbar>
      <form
        method="get"
        className="mb-4 flex flex-wrap items-end gap-2 print:hidden"
        aria-label="Report dates"
      >
        <div className="space-y-1">
          <label htmlFor="period" className="text-muted-foreground text-xs font-medium">
            Period
          </label>
          <NativeSelect id="period" name="period" defaultValue={q.period} className="w-32">
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1">
          <label htmlFor="date" className="text-muted-foreground text-xs font-medium">
            Day in the period
          </label>
          <Input
            key={toDateInput(q.date)}
            id="date"
            name="date"
            type="date"
            defaultValue={toDateInput(q.date)}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="from" className="text-muted-foreground text-xs font-medium">
            From (for “From – to”)
          </label>
          <Input
            id="from"
            name="from"
            type="date"
            defaultValue={toDateInput(q.from)}
            className="w-40"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="to" className="text-muted-foreground text-xs font-medium">
            To
          </label>
          <Input id="to" name="to" type="date" defaultValue={toDateInput(q.to)} className="w-40" />
        </div>
        <div className="space-y-1">
          <label htmlFor="companyId" className="text-muted-foreground text-xs font-medium">
            Company
          </label>
          <NativeSelect
            id="companyId"
            name="companyId"
            defaultValue={q.companyId ?? ""}
            className="w-48"
          >
            <option value="">All companies</option>
            {r.companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" variant="secondary" size="sm">
          Show
        </Button>
        {q.period !== "custom" ? (
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={link(shifted(q.period, q.date, -1))} aria-label={`Previous ${q.period}`}>
                ◀
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={link(shifted(q.period, q.date, 1))} aria-label={`Next ${q.period}`}>
                ▶
              </Link>
            </Button>
          </>
        ) : null}
      </form>

      <article className="print-sheet space-y-[1.2em] text-sm leading-snug">
        <Letterhead
          business={profile.business}
          right={
            <>
              <p className="font-bold">PRODUCTS SOLD</p>
              <p>{dates}</p>
              {company ? <p>{company.name}</p> : null}
            </>
          }
        />
        <p>
          <strong>{formatDozens(r.totals.quantity)}</strong> of {r.totals.products}{" "}
          {r.totals.products === 1 ? "product" : "products"}
          {r.totals.counter ? ` (${formatDozens(r.totals.counter)} at the counter)` : ""}
          {r.totals.amount ? (
            <>
              {" "}
              · sales <strong className="tabular-nums">{formatMoney(r.totals.amount)}</strong>
            </>
          ) : null}
          . After returns and damage; deliveries and counter sales.
        </p>
        {r.rows.length === 0 ? (
          <p>Nothing was sold in these dates.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>Product</th>
                <th className={th}>Company</th>
                <th className={`${th} ${num}`}>Sold</th>
                <th className={`${th} ${num}`}>At counter</th>
                <th className={`${th} ${num}`}>Bills</th>
                <th className={`${th} ${num}`}>Customers</th>
                {r.dayCount > 1 ? <th className={`${th} ${num}`}>Days sold</th> : null}
                {r.showAmounts ? <th className={`${th} ${num}`}>Sales</th> : null}
              </tr>
            </thead>
            <tbody>
              {r.rows.map((p) => (
                <tr key={p.productId}>
                  <td className={td}>
                    <Link href={`/inventory/${p.productId}`} className="print:no-underline">
                      {p.code}
                    </Link>{" "}
                    {p.name}
                  </td>
                  <td className={td}>{p.companyName}</td>
                  <td className={`${td} ${num} font-medium`}>{formatDozens(p.quantity)}</td>
                  <td className={`${td} ${num}`}>{p.counter ? formatDozens(p.counter) : "—"}</td>
                  <td className={`${td} ${num}`}>{p.bills}</td>
                  <td className={`${td} ${num}`}>{p.customers}</td>
                  {r.dayCount > 1 ? (
                    <td className={`${td} ${num}`}>
                      {p.days} of {r.dayCount}
                    </td>
                  ) : null}
                  {r.showAmounts ? (
                    <td className={`${td} ${num}`}>{formatMoney(p.amount!)}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <td className={td}>Total</td>
                <td className={td} />
                <td className={`${td} ${num}`}>{formatDozens(r.totals.quantity)}</td>
                <td className={`${td} ${num}`}>
                  {r.totals.counter ? formatDozens(r.totals.counter) : "—"}
                </td>
                <td className={td} />
                <td className={td} />
                {r.dayCount > 1 ? <td className={td} /> : null}
                {r.showAmounts ? (
                  <td className={`${td} ${num}`}>{formatMoney(r.totals.amount!)}</td>
                ) : null}
              </tr>
            </tfoot>
          </table>
        )}
      </article>
    </div>
  );
}
