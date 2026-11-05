import { Letterhead } from "@/components/print/print-frame";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { formatDozens, formatDozensCell } from "@/lib/units";
import type { getDriverSheet, TripView } from "@/server/services/delivery/trips";
import type { getPrintProfile } from "@/server/services/settings";

// The two printed trip sheets (lib/print.ts tripSheetCss), meant for A4 sideways but fitting
// whatever the print dialog chooses: the loading sheet (one landscape page: what to load, and the
// stops) and the driver sheet (one continuous table the driver fills in). Printed alone, or
// together on the two sides of one sheet.

type Business = Awaited<ReturnType<typeof getPrintProfile>>["business"];
type DriverSheetView = Awaited<ReturnType<typeof getDriverSheet>>;

/**
 * The loading sheet: one page box (`loading-page`, its text shrunk to fit a big load), products
 * to load on the left and the stops in visiting order on the right.
 */
export function LoadingSheet({ trip, business }: { trip: TripView; business: Business }) {
  const cell = "border-b border-black/40 px-[0.3em] py-[0.15em] align-top";
  const num = `${cell} text-right tabular-nums whitespace-nowrap`;
  const head = "border-y border-black px-[0.3em] py-[0.15em] text-left font-semibold";
  return (
    <section
      className="loading-page flex flex-col gap-[0.6em] bg-white leading-snug text-black"
      data-fit-page
      aria-label="Loading sheet"
    >
      <Letterhead
        business={business}
        right={
          <>
            <p className="text-[1.15em] font-bold">Loading sheet · Trip #{trip.number}</p>
            <p>
              {formatDate(trip.tripDate)} · {trip.bike.name} · Driver:{" "}
              {trip.driver?.name ?? "____________________"}
            </p>
          </>
        }
      />
      <div className="grid flex-1 grid-cols-[1.15fr_1fr] gap-[1.2em]">
        <div>
          <h2 className="mb-[0.2em] font-bold">
            Load ({formatDozens(trip.totals.load)} of {formatDozens(trip.bike.capacity)})
          </h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={head}>Code</th>
                <th className={head}>Product</th>
                <th className={`${head} text-right`}>Dozens</th>
                <th className={`${head} text-center`}>Loaded</th>
              </tr>
            </thead>
            <tbody>
              {trip.load.map((p, i) => {
                const header = i === 0 || p.companyName !== trip.load[i - 1]!.companyName;
                return [
                  header ? (
                    <tr key={`c-${p.productId}`}>
                      <td colSpan={4} className="pt-[0.3em] font-semibold">
                        {p.companyName}
                      </td>
                    </tr>
                  ) : null,
                  <tr key={p.productId}>
                    <td className={cell}>{p.code}</td>
                    <td className={cell}>{p.name}</td>
                    <td className={`${num} font-semibold`}>{formatDozensCell(p.quantity)}</td>
                    <td className={`${cell} text-center`}>☐</td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>
        <div className="text-[0.8em]">
          <h2 className="mb-[0.2em] text-[1.25em] font-bold">Stops ({trip.orders.length})</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={head}>#</th>
                <th className={head}>Customer</th>
                <th className={head}>Order</th>
                <th className={`${head} text-right`}>Dz</th>
                <th className={`${head} text-right`}>Bill</th>
              </tr>
            </thead>
            <tbody>
              {trip.orders.map((o, i) => (
                <tr key={o.id}>
                  <td className={cell}>{i + 1}</td>
                  <td className={cell}>
                    <span className="font-semibold">{o.customer.name}</span>
                    {o.customer.shopName ? ` · ${o.customer.shopName}` : ""}
                    <div>
                      {[o.customer.area?.name, o.customer.phone].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className={`${cell} whitespace-nowrap`}>
                    #{o.number}
                    {o.bill ? <div>Bill {o.bill.number}</div> : null}
                  </td>
                  <td className={num}>{formatDozensCell(o.quantity)}</td>
                  <td className={num}>{formatMoney(o.bill?.netAmount)}</td>
                </tr>
              ))}
              <tr className="font-bold">
                <td colSpan={3} className="border-t border-black px-[0.3em] py-[0.15em]">
                  Total
                </td>
                <td className="border-t border-black px-[0.3em] py-[0.15em] text-right tabular-nums">
                  {formatDozensCell(trip.totals.load)}
                </td>
                <td className="border-t border-black px-[0.3em] py-[0.15em] text-right tabular-nums">
                  {formatMoney(trip.totals.bills)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <footer className="flex justify-between gap-4">
        <p>Loaded by: __________________</p>
        <p>Driver: __________________</p>
      </footer>
    </section>
  );
}

/**
 * Column widths as shares of the page width (in mm of a landscape A4, 283 mm across): #,
 * customer, product, sent, returned, damaged, bill, previous, due, cash, online, cheque, sign.
 * Amounts have room for 12,345,678.00 in landscape; upright, the text is smaller to match.
 */
const COLUMNS_MM = [6, 50, 54, 10, 13, 13, 23, 23, 23, 16, 16, 20, 8];
const COLUMNS_TOTAL = COLUMNS_MM.reduce((a, b) => a + b, 0);

/**
 * The driver sheet: one continuous table, a row per product, the stop's customer, amounts and
 * payment boxes beside its products. The headings repeat on every page; a stop never splits.
 * Same order as day-end entry. Then the trip total and the cash handover.
 */
export function DriverSheet({ trip, business }: { trip: DriverSheetView; business: Business }) {
  const cell = "border border-black/60 px-[0.25em] py-[0.12em] align-top";
  const num = `${cell} text-right tabular-nums whitespace-nowrap`;
  const head =
    "border border-black px-[0.25em] py-[0.15em] text-left align-bottom text-[0.85em] leading-tight font-semibold break-words";
  const box = "border border-black/60 px-[0.4em] py-[0.2em]";
  return (
    <section
      className="space-y-[0.6em] bg-white leading-tight text-black"
      aria-label="Driver sheet"
    >
      <Letterhead
        business={business}
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
        <colgroup>
          {COLUMNS_MM.map((w, i) => (
            <col key={i} style={{ width: `${((w / COLUMNS_TOTAL) * 100).toFixed(2)}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th className={head}>#</th>
            <th className={head}>Customer</th>
            <th className={head}>Product</th>
            <th className={`${head} text-right`}>Sent dz</th>
            <th className={head}>Return pk</th>
            <th className={head}>Damage pk</th>
            <th className={`${head} text-right`}>This bill</th>
            <th className={`${head} text-right`}>Previous</th>
            <th className={`${head} text-right`}>Total due</th>
            <th className={head}>Cash</th>
            <th className={head}>Online (ref.)</th>
            <th className={head}>Cheque no. bank date</th>
            <th className={head}>Sign</th>
          </tr>
        </thead>
        {trip.stops.map((o, i) => {
          const rows = Math.max(o.lines.length, 1);
          return (
            <tbody key={o.id} className="break-inside-avoid border-t-2 border-black">
              <tr>
                <td rowSpan={rows} className={`${cell} font-bold`}>
                  {i + 1}
                </td>
                <td rowSpan={rows} className={`${cell} break-words`}>
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
                <ProductCells line={o.lines[0]} cell={cell} num={num} />
                <td rowSpan={rows} className={num}>
                  {formatMoney(o.amounts.bill)}
                </td>
                <td rowSpan={rows} className={num}>
                  {formatMoney(o.amounts.previous)}
                </td>
                <td rowSpan={rows} className={`${num} font-bold`}>
                  {formatMoney(o.amounts.due)}
                </td>
                <td rowSpan={rows} className={cell} />
                <td rowSpan={rows} className={cell} />
                <td rowSpan={rows} className={cell} />
                <td rowSpan={rows} className={cell} />
              </tr>
              {o.lines.slice(1).map((l) => (
                <tr key={l.id}>
                  <ProductCells line={l} cell={cell} num={num} />
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>

      <div className="break-inside-avoid space-y-[0.5em]">
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
        <div className="flex justify-between gap-4 pt-[0.8em]">
          <p>Driver: __________________</p>
          <p>Received by: __________________</p>
          <p>Time: __________</p>
        </div>
      </div>
    </section>
  );
}

/** One product row: what was sent, and empty boxes for what came back. */
function ProductCells({
  line,
  cell,
  num,
}: {
  line?: { quantity: number; product: { code: string; name: string; shortName: string | null } };
  cell: string;
  num: string;
}) {
  return (
    <>
      <td className={`${cell} truncate`}>
        {line ? `${line.product.code} ${line.product.shortName ?? line.product.name}` : ""}
      </td>
      <td className={num}>{line ? formatDozensCell(line.quantity) : ""}</td>
      <td className={cell} />
      <td className={cell} />
    </>
  );
}
