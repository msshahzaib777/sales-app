import type { Metadata } from "next";
import Link from "next/link";

import { RequirePermission } from "@/components/layout/no-access";
import { Letterhead, PrintStyles, PrintToolbar } from "@/components/print/print-frame";
import { Button } from "@/components/ui/button";
import {
  LATE_DAYS,
  PERIOD_KIND_LABEL,
  PERIOD_KINDS,
  type PeriodKind,
  shiftPeriod,
  type Trend,
  TREND_THRESHOLD,
} from "@/lib/analysis";
import { businessToday, toDateInput } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { statementPageCss } from "@/lib/print";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import { parseDateRange } from "@/server/services/purchasing/filters";
import { type BusinessAnalysis, businessAnalysis } from "@/server/services/reports/analysis";
import { getPrintProfile } from "@/server/services/settings";

export const metadata: Metadata = { title: "Business analysis" };

export default function AnalysisPage(props: PageProps<"/reports/analysis">) {
  return (
    <RequirePermission permission="operations.manage">
      <Report {...props} />
    </RequirePermission>
  );
}

const th = "border-b border-black py-[0.2em] pr-[0.8em] text-left font-semibold";
const td = "border-b border-dotted border-black/60 py-[0.15em] pr-[0.8em] align-top";
const num = "text-right tabular-nums whitespace-nowrap";

type Compared = { current: { toNumber(): number }; change: number | null };

async function Report({ searchParams }: PageProps<"/reports/analysis">) {
  const sp = await searchParams;
  // Session first: it makes the page dynamic before today's date is read.
  const ctx = await requireTenantContext("operations.manage");
  const kind: PeriodKind = PERIOD_KINDS.includes(sp.period as PeriodKind)
    ? (sp.period as PeriodKind)
    : "month";
  const date = parseDateRange({ from: sp.date }).from ?? businessToday();
  const [a, profile] = await Promise.all([businessAnalysis(ctx, kind, date), getPrintProfile(ctx)]);
  const link = (k: PeriodKind, d: Date) => `/reports/analysis?period=${k}&date=${toDateInput(d)}`;

  return (
    <div className="print-root">
      <PrintStyles css={statementPageCss(profile.print)} />
      <PrintToolbar back={{ href: "/reports", label: "Reports" }} hint="Prints on A4">
        <Button asChild variant="outline" size="sm">
          <a href={`/reports/analysis/export?period=${kind}&date=${toDateInput(date)}`}>
            Download Excel
          </a>
        </Button>
      </PrintToolbar>
      <nav aria-label="Period" className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        {PERIOD_KINDS.map((k) => (
          <Button key={k} asChild size="sm" variant={k === kind ? "default" : "outline"}>
            <Link href={link(k, date)}>{PERIOD_KIND_LABEL[k]}</Link>
          </Button>
        ))}
        <span className="mx-2" />
        <Button asChild variant="outline" size="sm">
          <Link href={link(kind, shiftPeriod(kind, date, -1).from)} aria-label="Previous period">
            ◀
          </Link>
        </Button>
        <span className="min-w-32 text-center font-medium">{a.current.label}</span>
        <Button asChild variant="outline" size="sm">
          <Link href={link(kind, shiftPeriod(kind, date, 1).from)} aria-label="Next period">
            ▶
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/reports/analysis?period=${kind}`}>This {kind}</Link>
        </Button>
      </nav>

      <article className="print-sheet space-y-[1.4em] text-sm leading-snug">
        <Letterhead
          business={profile.business}
          right={
            <>
              <p className="font-bold">BUSINESS ANALYSIS</p>
              <p>{a.current.label}</p>
              <p className="text-[0.85em]">compared with {a.previous.label}</p>
            </>
          }
        />
        <Overview a={a} />
        <TrendChart a={a} />
        <Products a={a} />
        {a.companies ? <Companies rows={a.companies} /> : null}
        {a.customers ? <Customers c={a.customers} /> : null}
        <p className="text-[0.8em]">
          Sales are bills by trip date, after returns. Rising or declining means a change of{" "}
          {TREND_THRESHOLD}% or more against {a.previous.label}.
          {a.showCost ? " Cost is at each product's current purchase rate." : ""}
          {a.showMoney
            ? ` "Pays late": takes over ${LATE_DAYS} days to pay on average, has a bill unpaid for over ${LATE_DAYS} days, or bounced a cheque.`
            : ""}
        </p>
      </article>
    </div>
  );
}

/** ▲ 12% / ▼ 8% against the previous period. `goodWhenDown` for figures where less is better. */
function Change({ value, goodWhenDown }: { value: Compared; goodWhenDown?: boolean }) {
  if (value.change === null) {
    return value.current.toNumber() > 0 ? <span className="text-[0.85em]">new</span> : null;
  }
  const up = value.change >= 0;
  const good = up !== Boolean(goodWhenDown);
  return (
    <span
      className={`text-[0.85em] whitespace-nowrap ${Math.abs(value.change) < 1 ? "" : good ? "text-green-700 print:text-black" : "text-red-700 print:text-black"}`}
    >
      {up ? "▲" : "▼"} {Math.abs(value.change).toFixed(0)}%
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-[0.5em]">
      <h2 className="border-b border-black text-[1.05em] font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Figure({
  label,
  value,
  change,
  note,
}: {
  label: string;
  value: string;
  change?: Compared | null;
  note?: string;
}) {
  return (
    <div className="rounded-md border border-black/40 p-[0.5em]">
      <p className="text-[0.85em]">{label}</p>
      <p className="text-[1.25em] font-bold tabular-nums">{value}</p>
      <p className="space-x-2">
        {change ? <Change value={change} /> : null}
        {note ? <span className="text-[0.8em]">{note}</span> : null}
      </p>
    </div>
  );
}

function Overview({ a }: { a: BusinessAnalysis }) {
  const o = a.overview;
  return (
    <div className="grid grid-cols-2 gap-[0.5em] sm:grid-cols-4 print:grid-cols-4">
      <Figure label="Sales" value={formatMoney(o.sales.current)} change={o.sales} />
      {o.gross ? (
        <Figure
          label="Gross profit"
          value={formatMoney(o.gross.current)}
          change={o.gross}
          note={o.margin !== null ? `margin ${o.margin.toFixed(1)}%` : undefined}
        />
      ) : null}
      {o.net ? (
        <Figure
          label="Net profit"
          value={formatMoney(o.net.current)}
          change={o.net}
          note="after expenses"
        />
      ) : null}
      {o.received ? (
        <Figure
          label="Payments received"
          value={formatMoney(o.received.current)}
          change={o.received}
        />
      ) : null}
      <Figure label="Orders delivered" value={String(o.orders.current)} change={o.orders} />
      <Figure
        label="Customers who bought"
        value={String(o.activeCustomers.current)}
        change={o.activeCustomers}
      />
    </div>
  );
}

function TrendChart({ a }: { a: BusinessAnalysis }) {
  const max = Math.max(...a.trend.map((t) => t.sales.toNumber()), 1);
  const pct = (v: number) => `${Math.max((v / max) * 100, 0)}%`;
  return (
    <Section title={`Trend: last ${a.trend.length} ${a.kind}s`}>
      <div
        className="flex h-40 items-end gap-[0.4em] border-b border-black pt-[0.5em]"
        role="img"
        aria-label={`Sales per ${a.kind}: ${a.trend.map((t) => `${t.label} ${formatMoney(t.sales)}`).join(", ")}`}
      >
        {a.trend.map((t) => (
          <div
            key={t.label}
            className="relative flex h-full flex-1 items-end"
            title={`${t.label}: sales ${formatMoney(t.sales)}${t.gross ? `, gross profit ${formatMoney(t.gross)}` : ""}`}
          >
            <div
              className="w-full rounded-t-sm bg-slate-400 print:bg-gray-400"
              style={{ height: pct(t.sales.toNumber()) }}
            />
            {t.gross ? (
              <div
                className="absolute bottom-0 left-1/4 w-1/2 bg-emerald-700 print:bg-black"
                style={{ height: pct(Math.max(t.gross.toNumber(), 0)) }}
              />
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex gap-[0.4em] text-[0.7em]">
        {a.trend.map((t) => (
          <span key={t.label} className="flex-1 truncate text-center">
            {t.label.replace("Week of ", "")}
          </span>
        ))}
      </div>
      <p className="text-[0.8em]">
        Grey: sales{a.showCost ? ". Green: gross profit" : ""}. Hover a bar for the figures.
      </p>
    </Section>
  );
}

const TREND_LABEL: Record<Trend, string> = {
  RISING: "Rising",
  DECLINING: "Declining",
  NEW: "New",
  STOPPED: "Stopped",
  STEADY: "Steady",
  NONE: "",
};

function Products({ a }: { a: BusinessAnalysis }) {
  const p = a.products;
  const short = (rows: typeof p.rows, title: string) => (
    <div className="space-y-[0.3em]">
      <p className="font-semibold">{title}</p>
      {rows.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.productId} className="flex justify-between gap-2">
              <span>
                {r.code} {r.name}
              </span>
              <span className="tabular-nums">
                {formatDozens(r.qty.current.toNumber())} <Change value={r.qty} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <Section title="Products: demand">
      <div className="grid gap-[1.5em] sm:grid-cols-2 print:grid-cols-2">
        {short(p.rising, "In demand (rising or new)")}
        {short(p.declining, "Declining or stopped")}
      </div>
      {p.rows.length === 0 ? (
        <p>Nothing sold in {a.current.label}.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Product</th>
              <th className={th}>Company</th>
              <th className={`${th} ${num}`}>Sold</th>
              <th className={`${th} ${num}`}>Before</th>
              <th className={`${th} ${num}`}>Sales</th>
              {a.showCost ? <th className={`${th} ${num}`}>Profit</th> : null}
              <th className={`${th} ${num}`}>Returned</th>
              <th className={th}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.productId}>
                <td className={td}>
                  {r.code} {r.name}
                </td>
                <td className={td}>{r.companyName}</td>
                <td className={`${td} ${num}`}>{formatDozens(r.qty.current.toNumber())}</td>
                <td className={`${td} ${num}`}>{formatDozens(r.qty.previous.toNumber())}</td>
                <td className={`${td} ${num}`}>{formatMoney(r.amount.current)}</td>
                {a.showCost ? (
                  <td className={`${td} ${num}`}>{r.profit ? formatMoney(r.profit) : ""}</td>
                ) : null}
                <td className={`${td} ${num}`}>
                  {r.returnRate !== null && r.returnRate > 0 ? `${r.returnRate.toFixed(0)}%` : ""}
                </td>
                <td className={td}>
                  {TREND_LABEL[r.trend]}{" "}
                  {r.trend === "NEW" || r.trend === "STOPPED" ? null : <Change value={r.qty} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function Companies({ rows }: { rows: NonNullable<BusinessAnalysis["companies"]> }) {
  return (
    <Section title="Companies: profit">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th}>Company</th>
            <th className={`${th} ${num}`}>Sold</th>
            <th className={`${th} ${num}`}>Sales</th>
            <th className={`${th} ${num}`}>Cost</th>
            <th className={`${th} ${num}`}>Gross profit</th>
            <th className={`${th} ${num}`}>Margin</th>
            <th className={`${th} ${num}`}>Damage claimed</th>
            <th className={`${th} ${num}`}>We owe now</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.companyId}>
              <td className={td}>{c.name}</td>
              <td className={`${td} ${num}`}>{formatDozens(c.qty)}</td>
              <td className={`${td} ${num}`}>
                {formatMoney(c.sales.current)} <Change value={c.sales} />
              </td>
              <td className={`${td} ${num}`}>{formatMoney(c.cost)}</td>
              <td className={`${td} ${num}`}>
                {formatMoney(c.gross.current)} <Change value={c.gross} />
              </td>
              <td className={`${td} ${num}`}>
                {c.margin !== null ? `${c.margin.toFixed(1)}%` : ""}
              </td>
              <td className={`${td} ${num}`}>
                {c.damageClaimed.isZero() ? "" : formatMoney(c.damageClaimed)}
              </td>
              <td className={`${td} ${num}`}>{formatMoney(c.payableNow)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Customers({ c }: { c: NonNullable<BusinessAnalysis["customers"]> }) {
  const days = (v: number | null) => (v === null ? "" : `${Math.round(v)} d`);
  const short = (
    rows: typeof c.rows,
    title: string,
    detail: (r: (typeof c.rows)[number]) => string,
  ) => (
    <div className="space-y-[0.3em]">
      <p className="font-semibold">{title}</p>
      {rows.length === 0 ? (
        <p>None.</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.customerId} className="flex justify-between gap-2">
              <Link href={`/customers/${r.customerId}/statement`} className="print:no-underline">
                {r.name}
                {r.phone ? <span className="text-[0.85em]"> · {r.phone}</span> : null}
              </Link>
              <span className="text-right tabular-nums">{detail(r)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
  return (
    <Section title="Customers: trends and payment">
      <div className="grid gap-[1.5em] sm:grid-cols-3 print:grid-cols-3">
        {short(c.late, "Pays late", (r) =>
          [
            r.oldestUnpaidDays !== null && r.oldestUnpaidDays > LATE_DAYS
              ? `bill unpaid ${r.oldestUnpaidDays} d`
              : null,
            r.avgDaysToPay !== null && r.avgDaysToPay > LATE_DAYS
              ? `pays in ${Math.round(r.avgDaysToPay)} d`
              : null,
            r.bounced ? `${r.bounced} bounced` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        )}
        {short(c.stopped, "Stopped buying", (r) => `was ${formatMoney(r.bought.previous)}`)}
        {short(c.growing, "Growing", (r) => formatMoney(r.bought.current))}
      </div>
      {c.rows.length > 0 ? (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Customer</th>
              <th className={`${th} ${num}`}>Bought</th>
              <th className={`${th} ${num}`}>Before</th>
              <th className={`${th} ${num}`}>Paid</th>
              <th className={`${th} ${num}`}>Days to pay</th>
              <th className={`${th} ${num}`}>Oldest unpaid</th>
              <th className={`${th} ${num}`}>Owes now</th>
              <th className={th}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {c.rows.map((r) => (
              <tr key={r.customerId}>
                <td className={td}>
                  <Link
                    href={`/customers/${r.customerId}/statement`}
                    className="print:no-underline"
                  >
                    {r.name}
                  </Link>
                  {r.shopName ? ` · ${r.shopName}` : ""}
                  {r.phone ? <div className="text-[0.85em]">{r.phone}</div> : null}
                </td>
                <td className={`${td} ${num}`}>{formatMoney(r.bought.current)}</td>
                <td className={`${td} ${num}`}>{formatMoney(r.bought.previous)}</td>
                <td className={`${td} ${num}`}>{r.paid.isZero() ? "" : formatMoney(r.paid)}</td>
                <td className={`${td} ${num}`}>{days(r.avgDaysToPay)}</td>
                <td className={`${td} ${num}`}>{days(r.oldestUnpaidDays)}</td>
                <td className={`${td} ${num}`}>{formatMoney(r.balance)}</td>
                <td className={td}>
                  {TREND_LABEL[r.trend]}
                  {r.late ? <strong> · pays late</strong> : null}
                  {r.bounced ? ` · ${r.bounced} bounced` : ""}
                  {r.flagged ? " · flagged" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Section>
  );
}
