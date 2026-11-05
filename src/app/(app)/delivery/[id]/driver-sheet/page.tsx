import type { Metadata } from "next";

import { orNotFound } from "@/components/master/page-helpers";
import { Letterhead, PrintStyles, PrintToolbar } from "@/components/print/print-frame";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { driverSheetCss } from "@/lib/print";
import { formatDozensCell } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import { getDriverSheet } from "@/server/services/delivery/trips";
import { getPrintProfile } from "@/server/services/settings";

export const metadata: Metadata = { title: "Driver sheet" };

/** Column widths in mm: #, customer, product, sent, returned, damaged, bill, previous, due,
 * result, cash, online, cheque, sign (278 of the 283 mm across A4 sideways). */
const COLUMNS_MM = [6, 46, 52, 10, 15, 15, 16, 17, 18, 18, 16, 18, 22, 9];

/**
 * The sheet the driver takes on the trip and fills in by hand at each shop: what was delivered,
 * returned and damaged per product, and how the customer paid. One continuous table on A4 turned
 * sideways: a row per product, the stop's customer, amounts and payment boxes beside its products;
 * the headings repeat on each page and a stop is never split across pages. Same order as day-end
 * entry, so the office types it in from top to bottom. Black and white.
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
  const cell = "border border-black/60 px-[0.3em] py-[0.12em] align-top";
  const num = `${cell} text-right tabular-nums whitespace-nowrap`;
  const blank = cell;
  const head = "border border-black px-[0.3em] py-[0.15em] text-left font-semibold align-bottom";
  const box = "border border-black/60 px-[0.4em] py-[0.2em]";

  return (
    <div className="print-root">
      <PrintStyles css={driverSheetCss()} />
      <PrintToolbar
        back={{ href: `/delivery/${id}`, label: `Trip #${trip.number}` }}
        hint="Prints on A4 sideways (landscape). The driver fills it in; enter it at day-end in the same order."
      />
      <article className="mx-auto w-full max-w-[297mm] space-y-[0.6em] bg-white leading-tight text-black">
        <Letterhead
          business={profile.business}
          right={
            <>
              <p className="text-[1.15em] font-bold">Driver sheet · Trip #{trip.number}</p>
              <p>
                {formatDate(trip.tripDate)} · {trip.bike.name} · Driver:{" "}
                {trip.driver?.name ?? "____________________"}
              </p>
            </>
          }
        />

        <table className="w-full table-fixed border-collapse">
          {/* Fixed widths (A4 sideways leaves 283 mm): product names on one line, the boxes
              to fill in just wide enough to write in. */}
          <colgroup>
            {COLUMNS_MM.map((w, i) => (
              <col key={i} style={{ width: `${w}mm` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className={head}>#</th>
              <th className={head}>Customer</th>
              <th className={head}>Product</th>
              <th className={`${head} text-right`}>Sent dz</th>
              <th className={head}>Returned pk</th>
              <th className={head}>Damaged pk</th>
              <th className={`${head} text-right`}>This bill</th>
              <th className={`${head} text-right`}>Previous</th>
              <th className={`${head} text-right`}>Total due</th>
              <th className={head}>
                Result
                <div className="font-normal">Done · Part · Refused</div>
              </th>
              <th className={head}>Cash</th>
              <th className={head}>Online (ref.)</th>
              <th className={head}>Cheque (no., bank, date)</th>
              <th className={head}>Sign</th>
            </tr>
          </thead>
          {trip.stops.map((o, i) => {
            const rows = Math.max(o.lines.length, 1);
            const first = o.lines[0];
            return (
              // One stop: its rows stay together on one page.
              <tbody key={o.id} className="break-inside-avoid border-t-2 border-black">
                <tr>
                  <td rowSpan={rows} className={`${cell} font-bold`}>
                    {i + 1}
                  </td>
                  <td rowSpan={rows} className={cell}>
                    <span className="font-bold">{o.customer.name}</span>
                    {o.customer.shopName ? ` · ${o.customer.shopName}` : ""}
                    <div className="text-[0.9em]">
                      {[
                        o.customer.area?.name,
                        o.customer.phone,
                        `#${o.number}${o.bill ? ` · Bill ${o.bill.number}` : ""}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </td>
                  <ProductCells line={first} cell={cell} num={num} blank={blank} />
                  <td rowSpan={rows} className={num}>
                    {formatMoney(o.amounts.bill)}
                  </td>
                  <td rowSpan={rows} className={num}>
                    {formatMoney(o.amounts.previous)}
                  </td>
                  <td rowSpan={rows} className={`${num} font-bold`}>
                    {formatMoney(o.amounts.due)}
                  </td>
                  <td rowSpan={rows} className={`${cell} whitespace-nowrap`}>
                    ☐ &nbsp;☐ &nbsp;☐
                  </td>
                  <td rowSpan={rows} className={blank} />
                  <td rowSpan={rows} className={blank} />
                  <td rowSpan={rows} className={blank} />
                  <td rowSpan={rows} className={blank} />
                </tr>
                {o.lines.slice(1).map((l) => (
                  <tr key={l.id}>
                    <ProductCells line={l} cell={cell} num={num} blank={blank} />
                  </tr>
                ))}
              </tbody>
            );
          })}
        </table>

        <section className="break-inside-avoid space-y-[0.5em]">
          <div className="flex flex-wrap items-stretch gap-[0.5em]">
            <p className={`${box} font-bold`}>
              Trip total · {trip.stops.length} {trip.stops.length === 1 ? "stop" : "stops"}
              <br />
              Bills {formatMoney(trip.sheetTotals.bills)} · Total due{" "}
              {formatMoney(trip.sheetTotals.due)}
            </p>
            {[
              "Cash collected",
              "Cheques (how many / amount)",
              "Online collected",
              "Road expenses: fuel",
              "Toll / other",
            ].map((label) => (
              <p key={label} className={`${box} min-w-[9em]`}>
                {label}
                <br />
                &nbsp;
              </p>
            ))}
            <p className={`${box} min-w-[10em] border-2 border-black font-bold`}>
              Cash handed over
              <br />
              &nbsp;
            </p>
          </div>
          <div className="flex justify-between gap-4 pt-[1em]">
            <p>Driver: __________________</p>
            <p>Received by: __________________</p>
            <p>Time: __________</p>
          </div>
        </section>
      </article>
    </div>
  );
}

/** One product row: what was sent, and empty boxes for what came back. */
function ProductCells({
  line,
  cell,
  num,
  blank,
}: {
  line?: {
    quantity: number;
    product: { code: string; name: string; shortName: string | null };
  };
  cell: string;
  num: string;
  blank: string;
}) {
  if (!line)
    return (
      <>
        <td className={cell} />
        <td className={num} />
        <td className={blank} />
        <td className={blank} />
      </>
    );
  return (
    <>
      <td className={`${cell} truncate`}>
        {line.product.code} {line.product.shortName ?? line.product.name}
      </td>
      <td className={num}>{formatDozensCell(line.quantity)}</td>
      <td className={blank} />
      <td className={blank} />
    </>
  );
}
