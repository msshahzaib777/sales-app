import type { Metadata } from "next";
import Link from "next/link";

import { type QuickAction, QuickActions } from "@/components/dashboard/quick-actions";
import { RequirePermission } from "@/components/layout/no-access";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, toDateInput } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { formatDozens } from "@/lib/units";
import type { Role } from "@/generated/prisma/enums";
import { can, type Permission } from "@/server/auth/permissions";
import { requireTenantContext } from "@/server/auth/session";
import { type Dashboard, DUE_SOON_DAYS, getDashboard } from "@/server/services/dashboard";
import { parseDateRange } from "@/server/services/purchasing/filters";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <RequirePermission permission="operations.manage">
      <DashboardView searchParams={searchParams} />
    </RequirePermission>
  );
}

const DAY_MS = 86_400_000;

async function DashboardView({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const ctx = await requireTenantContext("operations.manage");
  const { from: date } = parseDateRange({ from: sp.date });
  const d = await getDashboard(ctx, { date });
  const day = (offset: number) => toDateInput(new Date(d.today.getTime() + offset * DAY_MS));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`What needs attention · ${formatDate(d.today)}${d.isToday ? " (today)" : ""}`}
        actions={
          <form
            method="get"
            className="flex flex-wrap items-center gap-2"
            aria-label="Dashboard date"
          >
            <Button asChild variant="outline" size="sm">
              <Link href={`/dashboard?date=${day(-1)}`} aria-label="Previous day">
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
              <Link href={`/dashboard?date=${day(1)}`} aria-label="Next day">
                ▶
              </Link>
            </Button>
            {d.isToday ? null : (
              <Button asChild variant="ghost" size="sm">
                <Link href="/dashboard">Today</Link>
              </Button>
            )}
          </form>
        }
      />
      {d.isToday ? null : (
        <p className="text-muted-foreground text-sm" role="status">
          Trips, deliveries, money and bills are for {formatDate(d.today)}. Approvals, credit limits
          and low stock are always as they are now.
        </p>
      )}
      <QuickActions actions={quickActions(ctx.user.role, d)} />
      <div className="grid gap-4 lg:grid-cols-2">
        <TodaysWork work={d.work} date={d.today} isToday={d.isToday} />
        {d.money ? <MoneyToday money={d.money} date={d.isToday ? null : d.today} /> : null}
        <OverLimit customers={d.overLimit} />
        <LowStock stock={d.lowStock} />
      </div>
    </div>
  );
}

/** The everyday jobs this role can do; the ones with something waiting are marked urgent. */
function quickActions(role: Role, d: Dashboard): QuickAction[] {
  const w = d.work;
  const waiting = w.tripsOut[0];
  const tomorrow = toDateInput(w.tomorrow);
  const all: (QuickAction & { permission: Permission })[] = [
    {
      href: waiting ? `/delivery/${waiting.id}` : "/delivery?tripStatus=DISPATCHED",
      label: "Enter day-end",
      icon: "dayEnd",
      permission: "operations.manage",
      urgent: w.dayEndPending
        ? `${w.dayEndPending} order${w.dayEndPending === 1 ? "" : "s"} waiting`
        : undefined,
    },
    {
      href: `/delivery/new?date=${tomorrow}`,
      label: "Plan trips",
      icon: "trip",
      permission: "operations.manage",
      urgent: w.notOnTripTomorrow ? `${w.notOnTripTomorrow} for tomorrow not on a trip` : undefined,
    },
    { href: "/orders/new", label: "New order", icon: "order", permission: "operations.manage" },
    {
      href: "/payments/new",
      label: "Receive payment",
      icon: "payment",
      permission: "payments.manage",
    },
    {
      href: "/purchases/receipts/new",
      label: "Receive goods",
      icon: "goods",
      permission: "operations.manage",
    },
    { href: "/expenses/new", label: "Add expense", icon: "expense", permission: "expenses.manage" },
    {
      href: "/inventory/adjustments/new",
      label: "Adjust stock",
      icon: "adjust",
      permission: "stock.requestAdjustment",
    },
    {
      href: "/customers/new",
      label: "New customer",
      icon: "customer",
      permission: "masterData.manage",
    },
    {
      href: `/reports/daily?date=${toDateInput(d.today)}`,
      label: "Day report",
      icon: "report",
      permission: "operations.manage",
    },
  ];
  return all.filter((a) => can(role, a.permission)).map(({ permission: _p, ...a }) => a);
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

const TRIP_STATUS = { PLANNED: "Planned", DISPATCHED: "Out", RECONCILED: "Day-end done" } as Record<
  string,
  string
>;

function TodaysWork({
  work,
  date,
  isToday,
}: {
  work: Dashboard["work"];
  date: Date;
  isToday: boolean;
}) {
  const tomorrow = toDateInput(work.tomorrow);
  const on = toDateInput(date);
  const d = work.day;
  const lateOut = work.tripsOut.filter((t) => t.late);
  return (
    <Panel
      title={isToday ? "Today's work" : `Work on ${formatDate(date)}`}
      href={`/reports/daily?date=${on}`}
      linkLabel="Full day report"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat
          label="Trips"
          value={d.trips.length}
          href={`/delivery?from=${on}&to=${on}`}
          note={
            d.trips.length
              ? [
                  d.planned && `${d.planned} planned`,
                  d.out && `${d.out} out`,
                  d.done && `${d.done} day-end done`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
        />
        <Stat
          label="Orders delivered"
          value={`${d.delivered + d.partly + d.returned} of ${d.orders}`}
          href={`/orders?from=${on}&to=${on}`}
          note={
            d.orders
              ? [
                  d.delivered && `${d.delivered} delivered`,
                  d.partly && `${d.partly} partly`,
                  d.returned && `${d.returned} returned`,
                  d.stillOut && `${d.stillOut} day-end not entered`,
                  d.notDispatched && `${d.notDispatched} not sent yet`,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : undefined
          }
          alert={d.stillOut > 0 && !isToday && date < new Date()}
        />
        <Stat
          label="Billed"
          value={formatMoney(d.billed)}
          href={`/reports/daily?date=${on}`}
          note={
            d.sent
              ? `sent ${formatDozens(d.sent)}${d.returnedQty ? ` · returned ${formatDozens(d.returnedQty)}` : ""}${d.damagedQty ? ` · damaged ${formatDozens(d.damagedQty)}` : ""}`
              : undefined
          }
        />
        <Stat
          label={`Orders for ${isToday ? "tomorrow" : "the next day"} (${formatDate(work.tomorrow)})`}
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
          label="Day-end entries pending (all dates)"
          value={work.dayEndPending}
          href="/delivery?tripStatus=DISPATCHED"
          note={
            lateOut.length
              ? `${lateOut.length} trip${lateOut.length === 1 ? "" : "s"} late`
              : undefined
          }
          alert={lateOut.length > 0}
        />
      </div>
      {d.trips.length > 0 ? (
        <ul className="space-y-1 text-sm">
          {d.trips.map((t) => (
            <li key={t.id} className="flex flex-wrap justify-between gap-2">
              <Link href={`/delivery/${t.id}`} className="underline underline-offset-4">
                Trip #{t.number} · {t.bikeName} · {t.driverName ?? "no driver set"}
              </Link>
              <span className="text-muted-foreground">
                {TRIP_STATUS[t.status] ?? t.status} · {t.orders} order{t.orders === 1 ? "" : "s"}
                {t.toEnter ? ` · ${t.toEnter} to enter` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">No trips on {formatDate(date)}.</p>
      )}
      {work.adjustmentsPending ? (
        <p className="text-sm" role="status">
          <Link
            href="/inventory/adjustments?adjustmentStatus=PENDING"
            className="text-destructive underline underline-offset-4"
          >
            {work.adjustmentsPending} stock adjustment{work.adjustmentsPending === 1 ? "" : "s"}{" "}
            waiting for your approval
          </Link>
        </p>
      ) : null}
      {work.tripsOut.some((t) => t.tripDate.getTime() !== date.getTime()) ? (
        <ul className="space-y-1 text-sm" aria-label="Trips of other days still out">
          <li className="text-muted-foreground text-xs">Other days, day-end not entered:</li>
          {work.tripsOut
            .filter((t) => t.tripDate.getTime() !== date.getTime())
            .map((t) => (
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

function MoneyToday({
  money,
  date,
}: {
  money: NonNullable<Dashboard["money"]>;
  /** Null for today. */
  date: Date | null;
}) {
  const on = date ? `on ${formatDate(date)}` : "today";
  const day = date ? toDateInput(date) : null;
  const bills = money.companyBills;
  return (
    <Panel title={`Money ${on}`} href="/payments" linkLabel="Payments">
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
            href={`/payments?method=${method}&paymentStatus=POSTED${day ? `&from=${day}&to=${day}` : ""}`}
            note={`${c.count} payment${c.count === 1 ? "" : "s"}`}
          />
        ))}
      </div>
      <p className="text-sm">
        Collected {on} <strong className="tabular-nums">{formatMoney(money.collectedTotal)}</strong>
        {money.expensesToday ? (
          <>
            {" "}
            · spent{" "}
            <Link
              href={day ? `/expenses?from=${day}&to=${day}` : "/expenses"}
              className="underline underline-offset-4"
            >
              <strong className="tabular-nums">{formatMoney(money.expensesToday.amount)}</strong>
            </Link>{" "}
            on {money.expensesToday.count} expense{money.expensesToday.count === 1 ? "" : "s"}
          </>
        ) : null}
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
