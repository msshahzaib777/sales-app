import type { Metadata } from "next";

import { orNotFound } from "@/components/master/page-helpers";
import { Letterhead, PrintStyles, PrintToolbar } from "@/components/print/print-frame";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { statementPageCss } from "@/lib/print";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import { getTrip } from "@/server/services/delivery/trips";
import { getPrintProfile } from "@/server/services/settings";

export const metadata: Metadata = { title: "Loading sheet" };

/** What to load on the bike (product totals by company) and the stops in visiting order. A4. */
export default async function LoadingSheetPage({
  params,
}: PageProps<"/delivery/[id]/loading-sheet">) {
  const { id } = await params;
  const ctx = await requireTenantContext("operations.manage");
  const [trip, profile] = await Promise.all([orNotFound(getTrip(ctx, id)), getPrintProfile(ctx)]);
  const cell = "border-b border-black/40 px-[0.3em] py-[0.2em] align-top";
  const num = `${cell} text-right tabular-nums whitespace-nowrap`;
  const head = "border-y border-black px-[0.3em] py-[0.2em] text-left font-semibold";

  return (
    <div className="print-root">
      <PrintStyles css={statementPageCss(profile.print)} />
      <PrintToolbar
        back={{ href: `/delivery/${id}`, label: `Trip #${trip.number}` }}
        hint="Prints on A4"
      />
      <article className="mx-auto max-w-[210mm] space-y-[1em] bg-white leading-snug text-black">
        <Letterhead
          business={profile.business}
          right={
            <>
              <p className="text-[1.15em] font-bold">Loading sheet · Trip #{trip.number}</p>
              <p>{formatDate(trip.tripDate)}</p>
              <p>
                {trip.bike.name} · Driver: {trip.driver?.name ?? "____________________"}
              </p>
            </>
          }
        />
        <section>
          <h2 className="mb-[0.3em] font-bold">
            Load ({formatDozens(trip.totals.load)} of {formatDozens(trip.bike.capacity)})
          </h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={head}>Code</th>
                <th className={head}>Product</th>
                <th className={`${head} text-right`}>Dozens</th>
                <th className={`${head} w-[5em] text-center`}>Loaded</th>
              </tr>
            </thead>
            <tbody>
              {trip.load.map((p, i) => {
                const header = i === 0 || p.companyName !== trip.load[i - 1]!.companyName;
                return [
                  header ? (
                    <tr key={`c-${p.productId}`}>
                      <td colSpan={4} className="pt-[0.4em] font-semibold">
                        {p.companyName}
                      </td>
                    </tr>
                  ) : null,
                  <tr key={p.productId} className="break-inside-avoid">
                    <td className={cell}>{p.code}</td>
                    <td className={cell}>{p.name}</td>
                    <td className={num}>{formatDozens(p.quantity).replace(" dz", "")}</td>
                    <td className={`${cell} text-center`}>☐</td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </section>
        <section className="break-before-auto">
          <h2 className="mb-[0.3em] font-bold">Stops ({trip.orders.length})</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={head}>#</th>
                <th className={head}>Customer</th>
                <th className={head}>Address / phone</th>
                <th className={head}>Order</th>
                <th className={`${head} text-right`}>Dz</th>
                <th className={`${head} text-right`}>Bill</th>
              </tr>
            </thead>
            <tbody>
              {trip.orders.map((o, i) => (
                <tr key={o.id} className="break-inside-avoid">
                  <td className={cell}>{i + 1}</td>
                  <td className={cell}>
                    <span className="font-semibold">{o.customer.name}</span>
                    {o.customer.shopName ? <div>{o.customer.shopName}</div> : null}
                    {o.customer.area ? <div>{o.customer.area.name}</div> : null}
                  </td>
                  <td className={cell}>
                    {o.customer.address ?? ""}
                    {o.customer.phone ? <div>{o.customer.phone}</div> : null}
                  </td>
                  <td className={cell}>
                    #{o.number}
                    {o.bill ? <div>Bill #{o.bill.number}</div> : null}
                  </td>
                  <td className={num}>{formatDozens(o.quantity).replace(" dz", "")}</td>
                  <td className={num}>{formatMoney(o.bill?.netAmount)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td colSpan={4} className="border-t border-black px-[0.3em] py-[0.2em]">
                  Total
                </td>
                <td className="border-t border-black px-[0.3em] py-[0.2em] text-right tabular-nums">
                  {formatDozens(trip.totals.load).replace(" dz", "")}
                </td>
                <td className="border-t border-black px-[0.3em] py-[0.2em] text-right tabular-nums">
                  {formatMoney(trip.totals.bills)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
        <footer className="flex justify-between gap-4 pt-[2em]">
          <p>Loaded by: __________________</p>
          <p>Driver: __________________</p>
        </footer>
      </article>
    </div>
  );
}
