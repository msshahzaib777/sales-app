import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import type { PrintProfile } from "@/server/services/settings";

import { Letterhead } from "./print-frame";

type Money = { toString(): string; isZero(): boolean };

export type StatementRow = {
  id: string;
  entryDate: Date;
  typeLabel: string;
  description: string;
  companyName?: string;
  /** Raises the balance (a bill). */
  increase: Money;
  /** Lowers the balance (a payment, return or credit). */
  decrease: Money;
  balance: Money;
};

/**
 * A printable account statement on A4: letterhead, who it is for, the period, opening balance,
 * every entry with a running balance, and the closing balance.
 */
export function StatementDocument({
  business,
  title,
  party,
  range,
  columns,
  opening,
  rows,
  closing,
  showCompany,
  footer,
}: {
  business: PrintProfile["business"];
  title: string;
  party: React.ReactNode;
  range: { from?: Date; to?: Date };
  columns: { increase: string; decrease: string; balance: string };
  opening: Money;
  rows: StatementRow[];
  closing: Money;
  showCompany: boolean;
  footer?: React.ReactNode;
}) {
  const cell = "border-b border-black/40 px-[0.3em] py-[0.15em] align-top";
  const num = `${cell} text-right tabular-nums whitespace-nowrap`;
  const cols = showCompany ? 7 : 6;
  return (
    <article className="mx-auto max-w-[210mm] space-y-[0.8em] bg-white leading-snug text-black">
      <Letterhead
        business={business}
        right={
          <>
            <p className="text-[1.15em] font-bold">{title}</p>
            <p>
              {range.from ? formatDate(range.from) : "Start"} –{" "}
              {range.to ? formatDate(range.to) : "today"}
            </p>
          </>
        }
      />
      <div>{party}</div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-y border-black text-left">
            <th className="px-[0.3em] py-[0.2em] font-semibold">Date</th>
            <th className="px-[0.3em] py-[0.2em] font-semibold">Entry</th>
            <th className="px-[0.3em] py-[0.2em] font-semibold">Details</th>
            {showCompany ? <th className="px-[0.3em] py-[0.2em] font-semibold">Company</th> : null}
            <th className="px-[0.3em] py-[0.2em] text-right font-semibold">{columns.increase}</th>
            <th className="px-[0.3em] py-[0.2em] text-right font-semibold">{columns.decrease}</th>
            <th className="px-[0.3em] py-[0.2em] text-right font-semibold">{columns.balance}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={cell}>{range.from ? formatDate(range.from) : ""}</td>
            <td className={cell}>Opening</td>
            <td className={cell} colSpan={cols - 5}>
              Balance brought forward
            </td>
            <td className={cell} />
            <td className={cell} />
            <td className={num}>{formatMoney(opening)}</td>
          </tr>
          {rows.length === 0 ? (
            <tr>
              <td className={`${cell} text-center`} colSpan={cols}>
                No entries in this period.
              </td>
            </tr>
          ) : null}
          {rows.map((r) => (
            <tr key={r.id} className="break-inside-avoid">
              <td className={`${cell} whitespace-nowrap`}>{formatDate(r.entryDate)}</td>
              <td className={cell}>{r.typeLabel}</td>
              <td className={cell}>{r.description}</td>
              {showCompany ? <td className={cell}>{r.companyName}</td> : null}
              <td className={num}>{r.increase.isZero() ? "" : formatMoney(r.increase)}</td>
              <td className={num}>{r.decrease.isZero() ? "" : formatMoney(r.decrease)}</td>
              <td className={num}>{formatMoney(r.balance)}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className="border-t border-black px-[0.3em] py-[0.2em]">
              {range.to ? formatDate(range.to) : ""}
            </td>
            <td className="border-t border-black px-[0.3em] py-[0.2em]" colSpan={cols - 2}>
              Closing balance
            </td>
            <td className="border-t border-black px-[0.3em] py-[0.2em] text-right tabular-nums">
              {formatMoney(closing)}
            </td>
          </tr>
        </tbody>
      </table>
      {footer}
    </article>
  );
}
