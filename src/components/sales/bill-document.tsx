import { Letterhead } from "@/components/print/print-frame";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { formatDozens } from "@/lib/units";
import type { BillView } from "@/server/services/sales/bills";
import type { PrintProfile } from "@/server/services/settings";

type Line = BillView["lines"][number];

/**
 * One printed bill (full, or one company's slice): letterhead, customer, lines, then previous
 * pending, this bill and total due. Black and white; sizes in em so the tenant's font size setting
 * scales everything.
 */
export function BillDocument({
  view,
  business,
  title,
  lines,
  thisBill,
  previous,
  totalDue,
  showCompany,
}: {
  view: BillView;
  business: PrintProfile["business"];
  title?: string;
  lines: Line[];
  thisBill: { toString(): string };
  previous: { toString(): string };
  totalDue: { toString(): string };
  showCompany: boolean;
}) {
  const discount = lines.reduce((s, l) => s + Number(l.discountAmount), 0);
  const dz = (q: number) => formatDozens(q).replace(" dz", "");
  return (
    <article className="space-y-[0.6em] leading-snug">
      <Letterhead
        business={business}
        right={
          <>
            <p className="font-bold">BILL #{view.bill.number}</p>
            {view.bill.revision > 1 ? <p>Revision {view.bill.revision}</p> : null}
            <p>Date: {formatDate(view.bill.billDate)}</p>
            <p>Order #{view.order.number}</p>
          </>
        }
      />
      <div className="flex justify-between gap-4">
        <div>
          <p className="font-semibold">{view.customer.name}</p>
          {view.customer.shopName ? <p>{view.customer.shopName}</p> : null}
          {view.customer.address ? <p>{view.customer.address}</p> : null}
        </div>
        <div className="text-right">
          {view.customer.areaName ? <p>Area: {view.customer.areaName}</p> : null}
          {view.customer.phone ? <p>{view.customer.phone}</p> : null}
        </div>
      </div>
      {title ? <p className="font-semibold">{title}</p> : null}
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="py-[0.2em] pr-1 font-semibold">Product</th>
            {showCompany ? <th className="py-[0.2em] pr-1 font-semibold">Company</th> : null}
            <th className="py-[0.2em] pr-1 text-right font-semibold">Dz</th>
            <th className="py-[0.2em] pr-1 text-right font-semibold">Rate</th>
            <th className="py-[0.2em] pr-1 text-right font-semibold">Disc.</th>
            <th className="py-[0.2em] text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.productId} className="border-b border-dotted border-black/60">
              <td className="py-[0.1em] pr-1">
                {l.code} {l.name}
              </td>
              {showCompany ? <td className="py-[0.1em] pr-1">{l.companyName}</td> : null}
              <td className="py-[0.1em] pr-1 text-right tabular-nums">{dz(l.quantity)}</td>
              <td className="py-[0.1em] pr-1 text-right tabular-nums">{formatMoney(l.rate)}</td>
              <td className="py-[0.1em] pr-1 text-right tabular-nums">
                {Number(l.discountAmount) ? formatMoney(l.discountAmount) : ""}
              </td>
              <td className="py-[0.1em] text-right tabular-nums">{formatMoney(l.netAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto grid w-[18em] grid-cols-[1fr_auto] gap-x-3 text-right">
        <dt>Total dozens</dt>
        <dd className="tabular-nums">{dz(lines.reduce((s, l) => s + l.quantity, 0))}</dd>
        {discount ? (
          <>
            <dt>Company discount</dt>
            <dd className="tabular-nums">{formatMoney(discount.toFixed(2))}</dd>
          </>
        ) : null}
        <dt className="font-semibold">This bill</dt>
        <dd className="font-semibold tabular-nums">{formatMoney(thisBill)}</dd>
        <dt>Previous pending</dt>
        <dd className="tabular-nums">{formatMoney(previous)}</dd>
        <dt className="border-t border-black font-bold">Total due</dt>
        <dd className="border-t border-black font-bold tabular-nums">{formatMoney(totalDue)}</dd>
      </dl>
      <footer className="flex justify-between gap-4 pt-[1.5em]">
        <p>Received by: __________________</p>
        <p>Signature: ____________</p>
      </footer>
    </article>
  );
}

/** The documents for one bill: the full bill, or one per company when split. */
export function billDocuments(view: BillView, business: PrintProfile["business"], split: boolean) {
  if (!split) {
    return [
      {
        key: view.bill.id,
        node: (
          <BillDocument
            view={view}
            business={business}
            lines={view.lines}
            thisBill={view.bill.netAmount}
            previous={view.previous}
            totalDue={view.totalDue}
            showCompany={view.sections.length > 1}
          />
        ),
      },
    ];
  }
  return view.sections.map((s) => ({
    key: `${view.bill.id}-${s.companyId}`,
    node: (
      <BillDocument
        view={view}
        business={business}
        title={`${s.companyName} portion`}
        lines={s.lines}
        thisBill={s.thisBill}
        previous={s.previous}
        totalDue={s.totalDue}
        showCompany={false}
      />
    ),
  }));
}
