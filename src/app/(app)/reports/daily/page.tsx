import type { Metadata } from "next";
import Link from "next/link";

import { RequirePermission } from "@/components/layout/no-access";
import { Letterhead, PrintStyles, PrintToolbar } from "@/components/print/print-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { businessToday, formatDate, toDateInput } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { statementPageCss } from "@/lib/print";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import { parseDateRange } from "@/server/services/purchasing/filters";
import { type DailyReport, dailyReport } from "@/server/services/reports/daily";
import { getPrintProfile } from "@/server/services/settings";

export const metadata: Metadata = { title: "Daily report" };

export default function DailyReportPage(props: PageProps<"/reports/daily">) {
  return (
    <RequirePermission permission="operations.manage">
      <Report {...props} />
    </RequirePermission>
  );
}

const DAY_MS = 86_400_000;
const th = "border-b border-black py-[0.2em] pr-[0.8em] text-left font-semibold";
const td = "border-b border-dotted border-black/60 py-[0.15em] pr-[0.8em] align-top";
const num = "text-right tabular-nums whitespace-nowrap";
const STATUS = {
  DISPATCHED: "Still out",
  DELIVERED: "Delivered",
  PARTIALLY_DELIVERED: "Partly delivered",
  RETURNED: "Returned",
} as Record<string, string>;

async function Report({ searchParams }: PageProps<"/reports/daily">) {
  const sp = await searchParams;
  // Session first: it makes the page dynamic before today's date is read.
  const ctx = await requireTenantContext("operations.manage");
  const date = parseDateRange({ from: sp.date }).from ?? businessToday();
  const [r, profile] = await Promise.all([dailyReport(ctx, date), getPrintProfile(ctx)]);
  const day = (offset: number) => toDateInput(new Date(date.getTime() + offset * DAY_MS));

  return (
    <div className="print-root">
      <PrintStyles css={statementPageCss(profile.print)} />
      <PrintToolbar back={{ href: "/reports", label: "Reports" }} hint="Prints on A4">
        <Button asChild variant="outline" size="sm">
          <a href={`/reports/daily/export?date=${day(0)}`}>Download Excel</a>
        </Button>
      </PrintToolbar>
      <form
        method="get"
        className="mb-4 flex flex-wrap items-center gap-2 print:hidden"
        aria-label="Report date"
      >
        <Button asChild variant="outline" size="sm">
          <Link href={`/reports/daily?date=${day(-1)}`} aria-label="Previous day">
            ◀
          </Link>
        </Button>
        <label htmlFor="date" className="sr-only">
          Date
        </label>
        <Input
          key={day(0)}
          id="date"
          name="date"
          type="date"
          defaultValue={day(0)}
          className="w-40"
        />
        <Button type="submit" variant="secondary" size="sm">
          Show
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`/reports/daily?date=${day(1)}`} aria-label="Next day">
            ▶
          </Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/reports/daily">Today</Link>
        </Button>
      </form>

      <article className="print-sheet space-y-[1.2em] text-sm leading-snug">
        <Letterhead
          business={profile.business}
          right={
            <>
              <p className="font-bold">DAILY REPORT</p>
              <p>{formatDate(date)}</p>
            </>
          }
        />
        <NeedsAttention issues={r.issues} />
        <KeyNumbers r={r} />
        <Deliveries r={r} />
        <ProductsSold r={r} />
        {r.money ? <Money money={r.money} profit={r.profit} /> : null}
        {r.money ? <Pending pending={r.money.pending} /> : null}
        <Stock r={r} />
      </article>
    </div>
  );
}

/** The day's problems first, each linking to where it is fixed; the details follow below. */
function NeedsAttention({ issues }: { issues: DailyReport["issues"] }) {
  if (issues.length === 0) {
    return (
      <p className="rounded-md border border-emerald-600 p-[0.6em] font-medium text-emerald-800 dark:text-emerald-300 print:border-black print:text-black">
        ✓ Nothing needs attention for this day.
      </p>
    );
  }
  return (
    <section
      aria-labelledby="attention-heading"
      className="space-y-[0.3em] rounded-md border-2 border-amber-500 p-[0.6em] print:border-black"
    >
      <h2 id="attention-heading" className="text-[1.05em] font-bold">
        Needs attention ({issues.length})
      </h2>
      <ul className="space-y-[0.25em]">
        {issues.map((issue) => (
          <li key={issue.text} className="flex gap-2">
            <span
              className={
                issue.level === "problem"
                  ? "font-bold text-red-700 print:text-black"
                  : "font-bold text-amber-700 print:text-black"
              }
            >
              {issue.level === "problem" ? "●" : "▲"}
              <span className="sr-only">{issue.level === "problem" ? "Problem:" : "Warning:"}</span>
            </span>
            <Link href={issue.href} className="hover:underline print:no-underline">
              {issue.text}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid space-y-[0.4em]">
      <h2 className="border-b border-black text-[1.05em] font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Figure({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-md border border-black/40 p-[0.5em]">
      <p className="text-[0.85em]">{label}</p>
      <p className="text-[1.25em] font-bold tabular-nums">{value}</p>
      {note ? <p className="text-[0.8em]">{note}</p> : null}
    </div>
  );
}

function KeyNumbers({ r }: { r: DailyReport }) {
  return (
    <div className="grid grid-cols-2 gap-[0.5em] sm:grid-cols-4 print:grid-cols-4">
      <Figure
        label="Sold (billed)"
        value={formatMoney(r.soldTotals.amount)}
        note={formatDozens(r.soldTotals.quantity)}
      />
      <Figure
        label="Orders delivered"
        value={`${r.deliveries.orders - r.deliveries.stillOut} of ${r.deliveries.orders}`}
        note={
          [
            r.deliveries.stillOut ? `${r.deliveries.stillOut} day-end not entered` : null,
            r.counter.sales
              ? `+ ${r.counter.sales} counter sale${r.counter.sales === 1 ? "" : "s"}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || undefined
        }
      />
      {r.money ? (
        <>
          <Figure
            label="Received from customers"
            value={formatMoney(r.money.collections.total)}
            note={`${r.money.collections.count} payment${r.money.collections.count === 1 ? "" : "s"}`}
          />
          <Figure
            label="Customers owe (end of day)"
            value={formatMoney(r.money.pending.total)}
            note={`${r.money.pending.customers} customers · ${r.money.pending.overLimit} over limit`}
          />
          <Figure
            label="Cash in hand (today)"
            value={formatMoney(r.money.cashInHand.net)}
            note="cash in − cash out"
          />
          <Figure label="Expenses" value={formatMoney(r.money.expenses.total)} />
        </>
      ) : null}
      {r.profit ? (
        <>
          <Figure
            label="Gross profit"
            value={formatMoney(r.profit.gross)}
            note="sales − cost of goods"
          />
          <Figure
            label="Net profit"
            value={formatMoney(r.profit.net)}
            note="gross profit − expenses"
          />
        </>
      ) : null}
    </div>
  );
}

function Deliveries({ r }: { r: DailyReport }) {
  const d = r.deliveries;
  return (
    <Section title="Orders delivered">
      <p>
        {d.orders} orders billed: {d.delivered} delivered, {d.partly} partly, {d.returned} returned
        {d.stillOut ? `, ${d.stillOut} still out (day-end not entered)` : ""}. Sent{" "}
        {formatDozens(d.sent)}, kept {formatDozens(d.kept)}, returned {formatDozens(d.returnedQty)},
        damaged {formatDozens(d.damagedQty)}. Billed{" "}
        <strong className="tabular-nums">{formatMoney(d.billed)}</strong>.
      </p>
      {r.counter.sales ? (
        <p>
          Counter sales (collected at the warehouse): {r.counter.sales}, billed{" "}
          <strong className="tabular-nums">{formatMoney(r.counter.billed)}</strong>.
        </p>
      ) : null}
      {d.list.length > 0 ? (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Order</th>
              <th className={th}>Customer</th>
              <th className={th}>Status</th>
              <th className={`${th} ${num}`}>Bill</th>
            </tr>
          </thead>
          <tbody>
            {d.list.map((o) => (
              <tr key={o.id}>
                <td className={td}>
                  <Link href={`/orders/${o.id}`} className="print:no-underline">
                    #{o.number}
                  </Link>
                </td>
                <td className={td}>{o.customerName}</td>
                <td className={td}>
                  {o.counter ? "Counter sale" : (STATUS[o.status] ?? o.status)}
                </td>
                <td className={`${td} ${num}`}>{formatMoney(o.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Section>
  );
}

function ProductsSold({ r }: { r: DailyReport }) {
  return (
    <Section title="Products sold">
      {r.productsSold.length === 0 ? (
        <p>Nothing billed on this day.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Product</th>
              <th className={th}>Company</th>
              <th className={`${th} ${num}`}>Quantity</th>
              <th className={`${th} ${num}`}>Sales</th>
              {r.showCost ? (
                <>
                  <th className={`${th} ${num}`}>Cost</th>
                  <th className={`${th} ${num}`}>Profit</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {r.productsSold.map((p) => (
              <tr key={p.productId}>
                <td className={td}>
                  {p.code} {p.name}
                </td>
                <td className={td}>{p.companyName}</td>
                <td className={`${td} ${num}`}>{formatDozens(p.quantity)}</td>
                <td className={`${td} ${num}`}>{formatMoney(p.amount)}</td>
                {r.showCost ? (
                  <>
                    <td className={`${td} ${num}`}>{p.cost ? formatMoney(p.cost) : ""}</td>
                    <td className={`${td} ${num}`}>{p.profit ? formatMoney(p.profit) : ""}</td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="pt-[0.3em]" colSpan={2}>
                Total
              </td>
              <td className={`pt-[0.3em] pr-[0.8em] ${num}`}>
                {formatDozens(r.soldTotals.quantity)}
              </td>
              <td className={`pt-[0.3em] pr-[0.8em] ${num}`}>{formatMoney(r.soldTotals.amount)}</td>
              {r.showCost && r.soldTotals.cost ? (
                <>
                  <td className={`pt-[0.3em] pr-[0.8em] ${num}`}>
                    {formatMoney(r.soldTotals.cost)}
                  </td>
                  <td className={`pt-[0.3em] pr-[0.8em] ${num}`}>
                    {formatMoney(r.soldTotals.amount.sub(r.soldTotals.cost))}
                  </td>
                </>
              ) : null}
            </tr>
          </tfoot>
        </table>
      )}
      {r.showCost ? (
        <p className="text-[0.85em]">Cost is at each product&apos;s current purchase rate.</p>
      ) : null}
    </Section>
  );
}

function Money({
  money,
  profit,
}: {
  money: NonNullable<DailyReport["money"]>;
  profit: DailyReport["profit"];
}) {
  const c = money.collections;
  return (
    <Section title="Money">
      <div className="grid gap-[1.5em] sm:grid-cols-2 print:grid-cols-2">
        <div className="space-y-[0.4em]">
          <p className="font-semibold">Payments received from customers</p>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}></th>
                <th className={`${th} ${num}`}>At delivery</th>
                <th className={`${th} ${num}`}>At office</th>
                <th className={`${th} ${num}`}>Total</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Cash", c.cash],
                  ["Cheque", c.cheque],
                  ["Online", c.online],
                ] as const
              ).map(([label, m]) => (
                <tr key={label}>
                  <td className={td}>{label}</td>
                  <td className={`${td} ${num}`}>{formatMoney(m.atDelivery)}</td>
                  <td className={`${td} ${num}`}>{formatMoney(m.atOffice)}</td>
                  <td className={`${td} ${num}`}>{formatMoney(m.total)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="pt-[0.3em]" colSpan={3}>
                  Total received
                </td>
                <td className={`pt-[0.3em] pr-[0.8em] ${num}`}>{formatMoney(c.total)}</td>
              </tr>
            </tbody>
          </table>
          {money.bounced.count > 0 ? (
            <p>
              Cheques bounced: {money.bounced.count} for{" "}
              <strong className="tabular-nums">{formatMoney(money.bounced.amount)}</strong> (owed
              again).
            </p>
          ) : null}
        </div>
        <div className="space-y-[0.4em]">
          <p className="font-semibold">Cash in hand (today)</p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3">
            <dt>Cash received</dt>
            <dd className={num}>{formatMoney(money.cashInHand.in)}</dd>
            <dt>− Cash expenses</dt>
            <dd className={num}>{formatMoney(money.cashInHand.expenses)}</dd>
            <dt>− Cash paid to companies</dt>
            <dd className={num}>{formatMoney(money.cashInHand.toCompanies)}</dd>
            <dt className="border-t border-black font-bold">Cash in hand</dt>
            <dd className={`border-t border-black font-bold ${num}`}>
              {formatMoney(money.cashInHand.net)}
            </dd>
          </dl>
          <p className="font-semibold">Expenses</p>
          {money.expenses.byCategory.length === 0 ? (
            <p>None.</p>
          ) : (
            <dl className="grid grid-cols-[1fr_auto] gap-x-3">
              {money.expenses.byCategory.map((e) => (
                <div key={e.name} className="contents">
                  <dt>{e.name}</dt>
                  <dd className={num}>{formatMoney(e.amount)}</dd>
                </div>
              ))}
              <dt className="border-t border-black font-semibold">Total</dt>
              <dd className={`border-t border-black font-semibold ${num}`}>
                {formatMoney(money.expenses.total)}
              </dd>
            </dl>
          )}
          <p>
            Paid to companies:{" "}
            <strong className="tabular-nums">{formatMoney(money.companyPayments)}</strong>
          </p>
          {money.goodsReceived.length > 0 ? (
            <p>
              Goods received:{" "}
              {money.goodsReceived
                .map(
                  (g) =>
                    `#${g.number} ${g.companyName} ${formatDozens(g.quantity)} (${formatMoney(g.amount)})`,
                )
                .join("; ")}
            </p>
          ) : null}
          {profit ? (
            <>
              <p className="font-semibold">Profit</p>
              <dl className="grid grid-cols-[1fr_auto] gap-x-3">
                <dt>Sales</dt>
                <dd className={num}>{formatMoney(profit.sales)}</dd>
                <dt>− Cost of goods sold</dt>
                <dd className={num}>{formatMoney(profit.cost)}</dd>
                <dt className="font-semibold">Gross profit</dt>
                <dd className={`font-semibold ${num}`}>{formatMoney(profit.gross)}</dd>
                <dt>− Expenses</dt>
                <dd className={num}>{formatMoney(profit.expenses)}</dd>
                <dt className="border-t border-black font-bold">Net profit</dt>
                <dd className={`border-t border-black font-bold ${num}`}>
                  {formatMoney(profit.net)}
                </dd>
              </dl>
            </>
          ) : null}
        </div>
      </div>
    </Section>
  );
}

function Pending({ pending }: { pending: NonNullable<DailyReport["money"]>["pending"] }) {
  return (
    <Section title="Payment pending (customers owe, end of day)">
      <p>
        <strong className="tabular-nums">{formatMoney(pending.total)}</strong> from{" "}
        {pending.customers} customers; {pending.overLimit} over their credit limit. Most owed:
      </p>
      {pending.top.length > 0 ? (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Customer</th>
              <th className={th}>Contact</th>
              <th className={`${th} ${num}`}>Owes</th>
            </tr>
          </thead>
          <tbody>
            {pending.top.map((c) => (
              <tr key={c.customerId}>
                <td className={td}>
                  <Link
                    href={`/customers/${c.customerId}/statement`}
                    className="print:no-underline"
                  >
                    {c.name}
                  </Link>
                  {c.shopName ? ` · ${c.shopName}` : ""}
                  {c.overLimit ? " · over limit" : ""}
                </td>
                <td className={`${td} whitespace-nowrap tabular-nums`}>
                  {c.phone ? (
                    <a href={`tel:${c.phone}`} className="print:no-underline">
                      {c.phone}
                    </a>
                  ) : null}
                  {c.whatsapp && c.whatsapp !== c.phone ? (
                    <div className="text-[0.85em]">WhatsApp {c.whatsapp}</div>
                  ) : null}
                </td>
                <td className={`${td} ${num}`}>{formatMoney(c.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Section>
  );
}

function Stock({ r }: { r: DailyReport }) {
  // Products that moved today or need attention first; the unchanged rest is folded away.
  const busy = (s: DailyReport["stock"][number]) =>
    s.received || s.dispatched || s.returned || s.adjusted || s.low || s.closing < 0;
  const moved = r.stock.filter(busy);
  const quiet = r.stock.filter((s) => !busy(s));
  const head = (
    <thead>
      <tr>
        <th className={th}>Product</th>
        <th className={`${th} ${num}`}>Opening</th>
        <th className={`${th} ${num}`}>Received</th>
        <th className={`${th} ${num}`}>Sent out</th>
        <th className={`${th} ${num}`}>Returned</th>
        <th className={`${th} ${num}`}>Adjusted</th>
        <th className={`${th} ${num}`}>Closing</th>
        <th className={`${th} ${num}`}>Damaged</th>
      </tr>
    </thead>
  );
  const row = (s: DailyReport["stock"][number]) => (
    <tr key={s.productId} className={s.low || s.closing < 0 ? "font-semibold" : undefined}>
      <td className={td}>
        {s.code} {s.name}
        {s.closing < 0 ? " · below zero" : s.low ? " · low" : null}
      </td>
      <td className={`${td} ${num}`}>{formatDozens(s.opening)}</td>
      <td className={`${td} ${num}`}>{s.received ? formatDozens(s.received) : ""}</td>
      <td className={`${td} ${num}`}>{s.dispatched ? formatDozens(s.dispatched) : ""}</td>
      <td className={`${td} ${num}`}>{s.returned ? formatDozens(s.returned) : ""}</td>
      <td className={`${td} ${num}`}>{s.adjusted ? formatDozens(s.adjusted) : ""}</td>
      <td className={`${td} ${num} font-semibold`}>{formatDozens(s.closing)}</td>
      <td className={`${td} ${num}`}>{s.damaged ? formatDozens(s.damaged) : ""}</td>
    </tr>
  );
  return (
    <Section title="Stock left (end of day)">
      {moved.length ? (
        <table className="w-full border-collapse">
          {head}
          <tbody>{moved.map(row)}</tbody>
        </table>
      ) : (
        <p>No stock moved this day.</p>
      )}
      {quiet.length ? (
        <details>
          <summary className="cursor-pointer text-[0.9em]">
            {quiet.length} product{quiet.length === 1 ? "" : "s"} did not move (show)
          </summary>
          <table className="w-full border-collapse">
            {head}
            <tbody>{quiet.map(row)}</tbody>
          </table>
        </details>
      ) : null}
    </Section>
  );
}
