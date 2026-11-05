import {
  billLayout,
  billPageCss,
  COPY_LABELS,
  COPY_MARGIN_MM,
  copyFontPt,
  type PrintSettings,
  toSheets,
} from "@/lib/print";

import { FitCopies } from "./fit-copies";
import { PrintStyles } from "./print-frame";

const mm = (n: number) => `${n}mm`;

/**
 * Lays bills out on printed sheets: one per sheet, two per A4, or two copies of each bill side by
 * side on an A5 sheet turned sideways (ORIGINAL and DUPLICATE, a cut line between, each long bill
 * shrunk to fit its half). On screen the sheets are shown at their real paper size so the preview
 * matches the print.
 */
export function BillSheets({
  settings,
  bills,
}: {
  settings: PrintSettings;
  bills: { key: string; node: React.ReactNode }[];
}) {
  const layout = billLayout(settings);
  const screenCss = layout.sideBySide
    ? `@media screen {
  .print-sheet { width: ${mm(layout.sheet.widthMm)}; max-width: 100%; display: flex; }
  .print-bill { width: ${mm(layout.bill.widthMm)}; height: ${mm(layout.bill.heightMm)}; padding: ${mm(COPY_MARGIN_MM)}; overflow: hidden; box-sizing: border-box; position: relative; flex: none; }
  .print-bill + .print-bill { border-left: 1px dashed currentColor; }
}`
    : `@media screen {
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
      {layout.sideBySide ? <FitCopies fontPt={copyFontPt(settings)} /> : null}
      {toSheets(bills, layout.perSheet, layout.copies).map((sheet, i) => (
        <section
          key={i}
          className="print-sheet mx-auto overflow-x-auto border bg-white text-black shadow-sm print:mx-0 print:overflow-visible print:border-0 print:shadow-none"
          aria-label={`Sheet ${i + 1}`}
        >
          {sheet.map((b, j) => (
            <div
              key={`${b.key}-${j}`}
              className="print-bill"
              data-fit={layout.sideBySide ? "" : undefined}
            >
              {layout.copies === 2 ? (
                // In the top edge, above the bill: takes none of its space.
                <p className="absolute inset-x-0 top-[0.6mm] text-center text-[6.5pt] leading-none font-bold tracking-[0.2em]">
                  {COPY_LABELS[j]}
                </p>
              ) : null}
              {b.node}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
