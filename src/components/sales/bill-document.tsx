import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { formatDozens } from "@/lib/units";
import type { BillView } from "@/server/services/sales/bills";

type Line = BillView["lines"][number];

/**
 * A printed bill: black and white, A5 by default (Task 7 adds paper settings). Either the full
 * bill or one company's slice ("split by company"), each with previous pending, this bill and total
 * due for that scope.
 */
export function BillDocument({
  view,
  title,
  lines,
  thisBill,
  previous,
  totalDue,
  showCompany,
}: {
  view: BillView;
  title?: string;
  lines: Line[];
  thisBill: { toString(): string };
  previous: { toString(): string };
  totalDue: { toString(): string };
  showCompany: boolean;
}) {
  const discount = lines.reduce((s, l) => s + Number(l.discountAmount), 0);
  return (
    <article className="bill-page mx-auto max-w-[148mm] space-y-3 border p-4 text-[13px] leading-snug text-black print:border-0 print:p-0">
      <header className="flex justify-between gap-4 border-b border-black pb-2">
        <div>
          <p className="text-base font-bold">{view.tenant.name}</p>
          {view.tenant.address ? <p>{view.tenant.address}</p> : null}
          {view.tenant.phone ? <p>{view.tenant.phone}</p> : null}
        </div>
        <div className="text-right">
          <p className="font-bold">BILL #{view.bill.number}</p>
          {view.bill.revision > 1 ? <p>Revision {view.bill.revision}</p> : null}
          <p>Date: {formatDate(view.bill.billDate)}</p>
          <p>Order #{view.order.number}</p>
        </div>
      </header>
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
            <th className="py-1 pr-1 font-semibold">Product</th>
            {showCompany ? <th className="py-1 pr-1 font-semibold">Company</th> : null}
            <th className="py-1 pr-1 text-right font-semibold">Dz</th>
            <th className="py-1 pr-1 text-right font-semibold">Rate</th>
            <th className="py-1 pr-1 text-right font-semibold">Disc.</th>
            <th className="py-1 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.productId} className="border-b border-dotted border-black/60">
              <td className="py-0.5 pr-1">
                {l.code} {l.name}
              </td>
              {showCompany ? <td className="py-0.5 pr-1">{l.companyName}</td> : null}
              <td className="py-0.5 pr-1 text-right tabular-nums">
                {formatDozens(l.quantity).replace(" dz", "")}
              </td>
              <td className="py-0.5 pr-1 text-right tabular-nums">{formatMoney(l.rate)}</td>
              <td className="py-0.5 pr-1 text-right tabular-nums">
                {Number(l.discountAmount) ? formatMoney(l.discountAmount) : ""}
              </td>
              <td className="py-0.5 text-right tabular-nums">{formatMoney(l.netAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto grid w-64 grid-cols-[1fr_auto] gap-x-3 text-right">
        <dt>Total dozens</dt>
        <dd className="tabular-nums">
          {formatDozens(lines.reduce((s, l) => s + l.quantity, 0)).replace(" dz", "")}
        </dd>
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
      <footer className="flex justify-between gap-4 pt-6">
        <p>Received by: ____________________</p>
        <p>Signature: ______________</p>
      </footer>
    </article>
  );
}
