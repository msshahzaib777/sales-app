import type { Metadata } from "next";

import { orNotFound } from "@/components/master/page-helpers";
import { Letterhead, PrintStyles, PrintToolbar } from "@/components/print/print-frame";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { statementPageCss } from "@/lib/print";
import { formatDozensCell } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import { getDriverSheet } from "@/server/services/delivery/trips";
import { getPrintProfile } from "@/server/services/settings";

export const metadata: Metadata = { title: "Driver sheet" };

/**
 * The sheet the driver takes on the trip and fills in by hand at each shop: what was delivered,
 * returned and damaged per product, and how the customer paid. In the same order as day-end entry,
 * so the office types it in from top to bottom. A4, black and white.
 */
export default async function DriverSheetPage({
  params,
}: PageProps<"/delivery/[id]/driver-sheet">) {
  const { id } = await params;
  const ctx = await requireTenantContext("operations.manage");
  const [trip, profile] = await Promise.all([
    orNotFound(getDriverSheet(ctx, id)),
    getPrintProfile(ctx),
  ]);
  const cell = "border border-black/50 px-[0.3em] py-[0.15em] align-top";
  const num = `${cell} text-right tabular-nums whitespace-nowrap`;
  const head = "border border-black px-[0.3em] py-[0.15em] text-left font-semibold";
  const blank = `${cell} w-[6em]`;
  const line = "inline-block min-w-[7em] border-b border-black";

  return (
    <div className="print-root">
      <PrintStyles css={statementPageCss(profile.print)} />
      <PrintToolbar
        back={{ href: `/delivery/${id}`, label: `Trip #${trip.number}` }}
        hint="Prints on A4. The driver fills it in; enter it at day-end in the same order."
      />
      <article className="mx-auto max-w-[210mm] space-y-[0.8em] bg-white leading-snug text-black">
        <Letterhead
          business={profile.business}
          right={
            <>
              <p className="text-[1.15em] font-bold">Driver sheet · Trip #{trip.number}</p>
              <p>{formatDate(trip.tripDate)}</p>
              <p>
                {trip.bike.name} · Driver: {trip.driver?.name ?? "____________________"}
              </p>
            </>
          }
        />

        {trip.stops.map((o, i) => (
          <section key={o.id} className="break-inside-avoid border-2 border-black p-[0.4em]">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <p>
                <span className="font-bold">
                  {i + 1}. {o.customer.name}
                </span>
                {o.customer.shopName ? ` · ${o.customer.shopName}` : ""}
                {o.customer.area ? ` · ${o.customer.area.name}` : ""}
                {o.customer.phone ? ` · ${o.customer.phone}` : ""}
              </p>
              <p>
                Order #{o.number}
                {o.bill ? ` · Bill #${o.bill.number}` : ""}
              </p>
            </div>
            {o.customer.address ? <p>{o.customer.address}</p> : null}

            <table className="mt-[0.3em] w-full border-collapse">
              <thead>
                <tr>
                  <th className={head}>Product</th>
                  <th className={`${head} text-right`}>Sent (dz)</th>
                  <th className={`${head} w-[6em]`}>Returned (packets)</th>
                  <th className={`${head} w-[6em]`}>Damaged (packets)</th>
                </tr>
              </thead>
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.id}>
                    <td className={cell}>
                      {l.product.code} {l.product.shortName ?? l.product.name}
                    </td>
                    <td className={num}>{formatDozensCell(l.quantity)}</td>
                    <td className={blank} />
                    <td className={blank} />
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-[0.3em] grid grid-cols-3 gap-2 text-center">
              <p className="border border-black/50 p-[0.15em]">
                This bill
                <br />
                <span className="font-semibold tabular-nums">{formatMoney(o.amounts.bill)}</span>
              </p>
              <p className="border border-black/50 p-[0.15em]">
                Previous balance
                <br />
                <span className="font-semibold tabular-nums">
                  {formatMoney(o.amounts.previous)}
                </span>
              </p>
              <p className="border-2 border-black p-[0.15em]">
                Total due
                <br />
                <span className="font-bold tabular-nums">{formatMoney(o.amounts.due)}</span>
              </p>
            </div>

            <p className="mt-[0.4em]">
              ☐ Delivered &nbsp;&nbsp; ☐ Partly delivered &nbsp;&nbsp; ☐ Refused
            </p>
            <div className="mt-[0.4em] space-y-[0.5em]">
              <p>
                Cash: <span className={line} /> &nbsp; Online: <span className={line} /> Ref:{" "}
                <span className={line} />
              </p>
              <p>
                Cheque: <span className={line} /> No.: <span className={line} /> Bank:{" "}
                <span className={line} /> Date:{" "}
                <span className="inline-block min-w-[5em] border-b border-black" />
              </p>
              <p>
                Note: <span className="inline-block min-w-[22em] border-b border-black" /> &nbsp;
                Customer sign: <span className={line} />
              </p>
            </div>
          </section>
        ))}

        <section className="break-inside-avoid border-2 border-black p-[0.5em]">
          <h2 className="mb-[0.4em] font-bold">
            Trip total · {trip.stops.length} {trip.stops.length === 1 ? "stop" : "stops"} · Bills{" "}
            {formatMoney(trip.sheetTotals.bills)} · Total due {formatMoney(trip.sheetTotals.due)}
          </h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-[0.6em]">
            <p>
              Cash collected: <span className={line} />
            </p>
            <p>
              Cheques collected: <span className={line} /> (how many: ____ )
            </p>
            <p>
              Online collected: <span className={line} />
            </p>
            <p>
              Road expenses, fuel: <span className={line} />
            </p>
            <p>
              Road expenses, toll / other: <span className={line} />
            </p>
            <p className="font-semibold">
              Cash handed over: <span className={line} />
            </p>
          </div>
          <div className="mt-[1.6em] flex justify-between gap-4">
            <p>Driver: __________________</p>
            <p>Received by: __________________</p>
            <p>Time: __________</p>
          </div>
        </section>
      </article>
    </div>
  );
}
