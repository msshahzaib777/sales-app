import { billLayout, billPageCss, type PrintSettings, toSheets } from "@/lib/print";

import { PrintStyles } from "./print-frame";

const mm = (n: number) => `${n}mm`;

/**
 * Lays bills out on printed sheets: one per sheet, or two per A4 with a cut line. On screen the
 * sheets are shown at their real paper size so the preview matches the print.
 */
export function BillSheets({
  settings,
  bills,
}: {
  settings: PrintSettings;
  bills: { key: string; node: React.ReactNode }[];
}) {
  const layout = billLayout(settings);
  const screenCss = `@media screen {
  .print-sheet { width: ${mm(layout.sheet.widthMm)}; max-width: 100%; }
  .print-bill { min-height: ${mm(layout.bill.heightMm)}; padding: ${mm(settings.marginMm)}; }
  .print-bill + .print-bill { border-top: 1px dashed currentColor; }
}`;
  return (
    <div className="print-root space-y-6 print:space-y-0">
      <PrintStyles
        css={`
          ${billPageCss(settings)}\n${screenCss}
        `}
      />
      {toSheets(bills, layout.perSheet).map((sheet, i) => (
        <section
          key={i}
          className="print-sheet mx-auto border bg-white text-black shadow-sm print:mx-0 print:border-0 print:shadow-none"
          aria-label={`Sheet ${i + 1}`}
        >
          {sheet.map((b) => (
            <div key={b.key} className="print-bill">
              {b.node}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
