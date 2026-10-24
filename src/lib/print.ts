// Print layout rules (SPEC §11), shared by every printable page. Pure, so they are unit-tested.
//
// Bills print on the tenant's paper (A5 by default; A4, half-A4, A6 or a custom size), or two to an
// A4 sheet. Statements and reports print on A4. Margins and font size are tenant settings.

export const PAPER_SIZES = ["A5", "A4", "HALF_A4", "A6", "CUSTOM"] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

export const PAPER_LABEL: Record<PaperSize, string> = {
  A5: "A5 (148 × 210 mm)",
  A4: "A4 (210 × 297 mm)",
  HALF_A4: "Half A4 (210 × 148.5 mm)",
  A6: "A6 (105 × 148 mm)",
  CUSTOM: "Custom size",
};

const DIMENSIONS: Record<Exclude<PaperSize, "CUSTOM">, [number, number]> = {
  A4: [210, 297],
  A5: [148, 210],
  HALF_A4: [210, 148.5],
  A6: [105, 148],
};

export type PrintSettings = {
  paper: PaperSize;
  widthMm?: number | null;
  heightMm?: number | null;
  marginMm: number;
  fontSizePt: number;
  twoPerA4: boolean;
};

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paper: "A5",
  marginMm: 8,
  fontSizePt: 10,
  twoPerA4: false,
};

export type BillLayout = {
  /** The physical sheet that goes through the printer. */
  sheet: { widthMm: number; heightMm: number };
  /** The space for one bill (a whole sheet, or half of an A4). */
  bill: { widthMm: number; heightMm: number };
  perSheet: 1 | 2;
};

export function paperSize(s: Pick<PrintSettings, "paper" | "widthMm" | "heightMm">): {
  widthMm: number;
  heightMm: number;
} {
  if (s.paper === "CUSTOM") {
    if (!s.widthMm || !s.heightMm) return { widthMm: DIMENSIONS.A5[0], heightMm: DIMENSIONS.A5[1] };
    return { widthMm: s.widthMm, heightMm: s.heightMm };
  }
  const [widthMm, heightMm] = DIMENSIONS[s.paper];
  return { widthMm, heightMm };
}

export function billLayout(s: PrintSettings): BillLayout {
  if (s.twoPerA4) {
    return {
      sheet: { widthMm: 210, heightMm: 297 },
      bill: { widthMm: 210, heightMm: 148.5 },
      perSheet: 2,
    };
  }
  const size = paperSize(s);
  return { sheet: size, bill: size, perSheet: 1 };
}

/** Groups bills into printed sheets (pairs when printing two per A4). */
export function toSheets<T>(items: T[], perSheet: 1 | 2): T[][] {
  const sheets: T[][] = [];
  for (let i = 0; i < items.length; i += perSheet) sheets.push(items.slice(i, i + perSheet));
  return sheets;
}

const mm = (n: number) => `${Number(n.toFixed(2))}mm`;

/**
 * Print CSS for a page of bills. One bill per sheet: the page margin is the setting and a long bill
 * flows onto further pages. Two per A4: no page margin, each half gets the margin as padding, with
 * a dashed cut line between the halves.
 */
export function billPageCss(s: PrintSettings): string {
  const layout = billLayout(s);
  const common = `.print-root { font-size: ${s.fontSizePt}pt; }`;
  if (layout.perSheet === 2) {
    return [
      `@page { size: ${mm(210)} ${mm(297)}; margin: 0; }`,
      common,
      `@media print {`,
      `  .print-sheet { width: ${mm(210)}; height: ${mm(297)}; break-after: page; display: flex; flex-direction: column; }`,
      `  .print-sheet:last-child { break-after: auto; }`,
      `  .print-bill { height: ${mm(148.5)}; padding: ${mm(s.marginMm)}; overflow: hidden; box-sizing: border-box; }`,
      `  .print-bill + .print-bill { border-top: 1px dashed #000; }`,
      `}`,
    ].join("\n");
  }
  return [
    `@page { size: ${mm(layout.sheet.widthMm)} ${mm(layout.sheet.heightMm)}; margin: ${mm(s.marginMm)}; }`,
    common,
    `@media print {`,
    `  .print-sheet { break-after: page; }`,
    `  .print-sheet:last-child { break-after: auto; }`,
    `}`,
  ].join("\n");
}

/** Print CSS for statements and reports: A4 portrait with the tenant's margin and font size. */
export function statementPageCss(s: PrintSettings): string {
  return [
    `@page { size: ${mm(210)} ${mm(297)}; margin: ${mm(Math.max(s.marginMm, 8))}; }`,
    `.print-root { font-size: ${s.fontSizePt}pt; }`,
  ].join("\n");
}

/** "Prints on A5 (148 × 210 mm)" and similar, shown next to the print button. */
export function paperHint(s: PrintSettings): string {
  if (s.twoPerA4) return "Prints 2 bills per A4 sheet";
  if (s.paper === "CUSTOM") {
    const { widthMm, heightMm } = paperSize(s);
    return `Prints on ${widthMm} × ${heightMm} mm paper`;
  }
  return `Prints on ${PAPER_LABEL[s.paper]}`;
}
