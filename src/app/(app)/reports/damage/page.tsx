import type { Metadata } from "next";
import Link from "next/link";

import { RequirePermission } from "@/components/layout/no-access";
import { Letterhead, PrintStyles, PrintToolbar } from "@/components/print/print-frame";
import { StatementRangeForm } from "@/components/print/range-form";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { formatDate, PERIODS, toDateInput } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { statementPageCss } from "@/lib/print";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import {
  CLAIM_STATUS_LABEL,
  damageReport,
  damageReportOptions,
  parseDamageFilters,
} from "@/server/services/reports/damage";
import { getPrintProfile } from "@/server/services/settings";

export const metadata: Metadata = { title: "Damage report" };

export default function DamageReportPage(props: PageProps<"/reports/damage">) {
  return (
    <RequirePermission permission="operations.manage">
      <Report {...props} />
    </RequirePermission>
  );
}

const th = "border-b border-black py-[0.2em] pr-[0.8em] text-left font-semibold";
const td = "border-b border-dotted border-black/60 py-[0.15em] pr-[0.8em] align-top";
const num = "text-right tabular-nums";

async function Report({ searchParams }: PageProps<"/reports/damage">) {
  const sp = await searchParams;
  const f = parseDamageFilters(sp);
  const ctx = await requireTenantContext("operations.manage");
  const [report, options, profile] = await Promise.all([
    damageReport(ctx, f),
    damageReportOptions(ctx, f),
    getPrintProfile(ctx),
  ]);
  const query = (extra: Record<string, string>) =>
    new URLSearchParams({
      ...Object.fromEntries(
        (["driverId", "tripId", "productId", "companyId"] as const)
          .filter((k) => f[k])
          .map((k) => [k, f[k]!]),
      ),
      ...extra,
    }).toString();
  const dates = { from: toDateInput(f.from!), to: toDateInput(f.to!) };
  const select = (
    name: string,
    label: string,
    value: string | undefined,
    choices: { value: string; label: string }[],
    all: string,
  ) => (
    <div className="space-y-1">
      <label htmlFor={name} className="text-muted-foreground text-xs font-medium">
        {label}
      </label>
      <NativeSelect id={name} name={name} defaultValue={value ?? ""} className="w-44">
        <option value="">{all}</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
  const chosen = [
    f.driverId && `Driver: ${options.drivers.find((d) => d.id === f.driverId)?.name}`,
    f.tripId && `Trip #${options.trips.find((t) => t.id === f.tripId)?.number ?? ""}`,
    f.productId && `Product: ${options.products.find((p) => p.id === f.productId)?.name}`,
    f.companyId && `Company: ${options.companies.find((c) => c.id === f.companyId)?.name}`,
  ].filter(Boolean);
  const cols = report.showValue ? 9 : 7;

  return (
    <div className="print-root">
      <PrintStyles css={statementPageCss(profile.print)} />
      <PrintToolbar back={{ href: "/reports", label: "Reports" }} hint="Prints on A4">
        <Button asChild variant="outline" size="sm">
          <a href={`/reports/damage/export?${query(dates)}`}>Download Excel</a>
        </Button>
      </PrintToolbar>
      <nav aria-label="Period" className="mb-2 flex flex-wrap gap-2 print:hidden">
        {Object.entries(PERIODS).map(([key, label]) => (
          <Button key={key} asChild size="sm" variant={f.period === key ? "default" : "outline"}>
            <Link href={`/reports/damage?${query({ period: key })}`}>{label}</Link>
          </Button>
        ))}
      </nav>
      {/* Keyed by the dates so a period link refills the boxes (they are uncontrolled). */}
      <StatementRangeForm key={`${dates.from}:${dates.to}`} range={f}>
        {select(
          "driverId",
          "Driver",
          f.driverId,
          options.drivers.map((d) => ({ value: d.id, label: d.name })),
          "All drivers",
        )}
        {select(
          "tripId",
          "Trip",
          f.tripId,
          options.trips.map((t) => ({
            value: t.id,
            label: `#${t.number} · ${formatDate(t.tripDate)} · ${t.bike.name}`,
          })),
          "All trips",
        )}
        {select(
          "productId",
          "Product",
          f.productId,
          options.products.map((p) => ({ value: p.id, label: `${p.code} ${p.name}` })),
          "All products",
        )}
        {select(
          "companyId",
          "Company",
          f.companyId,
          options.companies.map((c) => ({ value: c.id, label: c.name })),
          "All companies",
        )}
      </StatementRangeForm>

      <article className="print-sheet space-y-[0.8em] text-sm leading-snug">
        <Letterhead
          business={profile.business}
          right={
            <>
              <p className="font-bold">DAMAGE REPORT</p>
              <p>
                {formatDate(f.from!)} – {formatDate(f.to!)}
              </p>
              {chosen.map((c) => (
                <p key={c as string}>{c}</p>
              ))}
            </>
          }
        />
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>Date</th>
              <th className={th}>Trip</th>
              <th className={th}>Driver</th>
              <th className={th}>Order · customer</th>
              <th className={th}>Product</th>
              <th className={th}>Company</th>
              <th className={`${th} ${num}`}>Damaged</th>
              {report.showValue ? (
                <>
                  <th className={`${th} ${num}`}>Claimed</th>
                  <th className={th}>Claim</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={cols} className="py-2 text-center">
                  No damage in this period.
                </td>
              </tr>
            ) : null}
            {report.rows.map((r) => (
              <tr key={r.id}>
                <td className={`${td} whitespace-nowrap`}>{formatDate(r.tripDate)}</td>
                <td className={td}>
                  <Link href={`/delivery/${r.tripId}`} className="print:no-underline">
                    #{r.tripNumber}
                  </Link>
                </td>
                <td className={td}>{r.driverName}</td>
                <td className={td}>
                  #{r.orderNumber} · {r.customerName}
                </td>
                <td className={td}>
                  {r.productCode} {r.productName}
                </td>
                <td className={td}>{r.companyName}</td>
                <td className={`${td} ${num} whitespace-nowrap`}>{formatDozens(r.quantity)}</td>
                {report.showValue ? (
                  <>
                    <td className={`${td} ${num}`}>
                      {r.claim ? formatMoney(r.claim.claimed) : ""}
                    </td>
                    <td className={td}>
                      {r.claim ? CLAIM_STATUS_LABEL[r.claim.status] : ""}
                      {r.claim?.accepted && !r.claim.accepted.eq(r.claim.claimed)
                        ? ` (${formatMoney(r.claim.accepted)})`
                        : ""}
                    </td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="pt-[0.3em] pr-[0.8em]" colSpan={6}>
                Total
              </td>
              <td className={`pt-[0.3em] pr-[0.8em] ${num} whitespace-nowrap`}>
                {formatDozens(report.totals.quantity)}
              </td>
              {report.showValue ? (
                <>
                  <td className={`pt-[0.3em] pr-[0.8em] ${num}`}>
                    {formatMoney(report.totals.claimed)}
                  </td>
                  <td className="pt-[0.3em]">accepted {formatMoney(report.totals.accepted)}</td>
                </>
              ) : null}
            </tr>
          </tfoot>
        </table>
        {report.rows.length > 0 ? (
          <div className="grid gap-[1.5em] sm:grid-cols-2 print:grid-cols-2">
            {(
              [
                ["By driver", report.byDriver],
                ["By product", report.byProduct],
              ] as const
            ).map(([title, groups]) => (
              <section key={title} className="break-inside-avoid">
                <p className="font-semibold">{title}</p>
                <table className="w-full border-collapse">
                  <tbody>
                    {groups.map((g) => (
                      <tr key={g.name}>
                        <td className={td}>{g.name}</td>
                        <td className={`${td} ${num} whitespace-nowrap`}>
                          {formatDozens(g.quantity)}
                        </td>
                        {report.showValue ? (
                          <td className={`${td} ${num}`}>{formatMoney(g.claimed)}</td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>
        ) : null}
      </article>
    </div>
  );
}
