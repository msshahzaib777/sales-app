import type { Metadata } from "next";
import Link from "next/link";

import { RequirePermission } from "@/components/layout/no-access";
import { PageHeader } from "@/components/layout/page-header";
import { formatDate, toDateInput } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import { type Dashboard, DUE_SOON_DAYS, getDashboard } from "@/server/services/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <RequirePermission permission="operations.manage">
      <DashboardView />
    </RequirePermission>
  );
}

async function DashboardView() {
  const ctx = await requireTenantContext("operations.manage");
  const d = await getDashboard(ctx);
  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description={`What needs attention · ${formatDate(d.today)}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <TodaysWork work={d.work} />
        {d.money ? <MoneyToday money={d.money} /> : null}
        <OverLimit customers={d.overLimit} />
        <LowStock stock={d.lowStock} />
      </div>
    </div>
  );
}

function Panel({
  title,
  href,
  linkLabel,
  children,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  children: React.ReactNode;
}) {
  const id = `panel-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="space-y-3 rounded-lg border p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="font-medium">
          {title}
        </h2>
        {href ? (
          <Link href={href} className="text-muted-foreground text-sm underline underline-offset-4">
            {linkLabel ?? "Open"}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A big number with a label, linking to the list behind it. */
function Stat({
  label,
  value,
  href,
  note,
  alert,
}: {
  label: string;
  value: React.ReactNode;
  href: string;
  note?: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <Link href={href} className="hover:bg-muted/50 block rounded-md border p-3 transition-colors">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${alert ? "text-destructive" : ""}`}>
        {value}
      </p>
      {note ? <p className="text-muted-foreground text-xs">{note}</p> : null}
    </Link>
  );
}

function TodaysWork({ work }: { work: Dashboard["work"] }) {
  const tomorrow = toDateInput(work.tomorrow);
  return (
    <Panel title="Today's work">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat
          label={`Orders for tomorrow (${formatDate(work.tomorrow)})`}
          value={work.ordersTomorrow}
          href={`/orders?orderStatus=open&from=${tomorrow}&to=${tomorrow}`}
          note={
            work.notOnTripTomorrow > 0
              ? `${work.notOnTripTomorrow} not on a trip yet`
              : work.ordersTomorrow > 0
                ? "All on trips"
                : undefined
          }
          alert={work.notOnTripTomorrow > 0}
        />
        <Stat
          label="Trips out"
          value={work.tripsOut.length}
          href="/delivery?tripStatus=DISPATCHED"
        />
        <Stat
          label="Day-end entries pending"
          value={work.dayEndPending}
          href="/delivery?tripStatus=DISPATCHED"
          note={work.dayEndPending > 0 ? "orders still out" : undefined}
          alert={work.tripsOut.some((t) => t.late)}
        />
      </div>
      {work.tripsOut.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {work.tripsOut.map((t) => (
            <li key={t.id} className="flex flex-wrap justify-between gap-2">
              <Link href={`/delivery/${t.id}`} className="underline underline-offset-4">
                Trip #{t.number} · {t.bikeName} · {t.driverName ?? "no driver set"}
              </Link>
              <span className={t.late ? "text-destructive" : "text-muted-foreground"}>
                {formatDate(t.tripDate)} · {t.ordersPending} to enter
                {t.late ? " · day-end late" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

function MoneyToday({ money }: { money: NonNullable<Dashboard["money"]> }) {
  const bills = money.companyBills;
  return (
    <Panel title="Money today" href="/payments" linkLabel="Payments">
      <div className="grid gap-2 sm:grid-cols-3">
        {(
          [
            ["Cash", money.collected.cash, "CASH"],
            ["Cheques", money.collected.cheque, "CHEQUE"],
            ["Online", money.collected.online, "ONLINE"],
          ] as const
        ).map(([label, c, method]) => (
          <Stat
            key={method}
            label={`${label} collected`}
            value={formatMoney(c.amount)}
            href={`/payments?method=${method}&paymentStatus=POSTED`}
            note={`${c.count} payment${c.count === 1 ? "" : "s"}`}
          />
        ))}
      </div>
      <p className="text-sm">
        Collected today{" "}
        <strong className="tabular-nums">{formatMoney(money.collectedTotal)}</strong>
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat
          label="Cheques waiting to clear"
          value={formatMoney(money.chequesToClear.amount)}
          href="/payments?cheque=PENDING"
          note={`${money.chequesToClear.count} cheque${money.chequesToClear.count === 1 ? "" : "s"}`}
        />
        <Stat
          label="Company bills overdue"
          value={formatMoney(bills.overdue.total)}
          href="/purchases/bills?show=overdue"
          note={`${bills.overdue.rows.length} bill${bills.overdue.rows.length === 1 ? "" : "s"}`}
          alert={bills.overdue.rows.length > 0}
        />
        <Stat
          label={`Company bills due in ${DUE_SOON_DAYS} days`}
          value={formatMoney(bills.dueSoon.total)}
          href="/purchases/bills?show=open"
          note={`${bills.dueSoon.rows.length} bill${bills.dueSoon.rows.length === 1 ? "" : "s"}`}
        />
      </div>
      {bills.overdue.rows.length + bills.dueSoon.rows.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {[...bills.overdue.rows, ...bills.dueSoon.rows].slice(0, 8).map((b) => (
            <li key={b.id} className="flex flex-wrap justify-between gap-2">
              <Link href={`/purchases/bills/${b.id}`} className="underline underline-offset-4">
                Bill #{b.number} · {b.companyName}
              </Link>
              <span className={b.overdue ? "text-destructive" : "text-muted-foreground"}>
                {formatMoney(b.outstanding)} ·{" "}
                {b.overdue
                  ? `${b.daysOverdue} day${b.daysOverdue === 1 ? "" : "s"} overdue`
                  : `due ${formatDate(b.dueDate)}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Panel>
  );
}

function OverLimit({ customers }: { customers: Dashboard["overLimit"] }) {
  return (
    <Panel title={`Over their credit limit (${customers.length})`} href="/customers">
      {customers.length === 0 ? (
        <p className="text-muted-foreground text-sm">No customer is over their limit.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="py-1 font-normal">Customer</th>
              <th className="py-1 text-right font-normal">Owes</th>
              <th className="py-1 text-right font-normal">Limit</th>
              <th className="py-1 text-right font-normal">Over by</th>
            </tr>
          </thead>
          <tbody>
            {customers.slice(0, 10).map((c) => (
              <tr key={c.id} className="border-t">
                <td className="py-1">
                  <Link
                    href={`/customers/${c.id}/statement`}
                    className="underline underline-offset-4"
                  >
                    {c.name}
                  </Link>
                  {c.shopName ? (
                    <span className="text-muted-foreground"> · {c.shopName}</span>
                  ) : null}
                  {c.isFlagged ? <span className="text-destructive"> · flagged</span> : null}
                </td>
                <td className="py-1 text-right tabular-nums">{formatMoney(c.balance)}</td>
                <td className="py-1 text-right tabular-nums">{formatMoney(c.creditLimit)}</td>
                <td className="text-destructive py-1 text-right font-medium tabular-nums">
                  {formatMoney(c.over)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {customers.length > 10 ? (
        <p className="text-muted-foreground text-xs">and {customers.length - 10} more</p>
      ) : null}
    </Panel>
  );
}

function LowStock({ stock }: { stock: Dashboard["lowStock"] }) {
  return (
    <Panel title={`Low stock (${stock.total})`} href="/inventory?level=low" linkLabel="Inventory">
      {stock.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing is below its minimum level.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="py-1 font-normal">Product</th>
              <th className="py-1 text-right font-normal">Available</th>
              <th className="py-1 text-right font-normal">Minimum</th>
            </tr>
          </thead>
          <tbody>
            {stock.rows.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="py-1">
                  <span className="font-mono">{p.code}</span> {p.name}
                  <span className="text-muted-foreground"> · {p.companyName}</span>
                </td>
                <td className="text-destructive py-1 text-right tabular-nums">
                  {formatDozens(p.available)}
                </td>
                <td className="py-1 text-right tabular-nums">{formatDozens(p.minStockLevel)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
