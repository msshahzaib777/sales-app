// Print layout rules (SPEC §11), shared by every printable page. Pure, so they are unit-tested.
//
// Bills print on the tenant's paper (A5 by default; A4, half-A4, A6 or a custom size), two to an
// A4 sheet, or two copies of the same bill on one A5 sheet. Statements and reports print on A4. Margins and font size are tenant settings.

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
  /** Each bill printed twice on one A5 sheet (two A6 halves with a cut line). */
  twoCopiesPerA5?: boolean;
  /** The short bill layout, for small paper. */
  compact?: boolean;
};

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  paper: "A5",
  marginMm: 8,
  fontSizePt: 10,
  twoPerA4: false,
  twoCopiesPerA5: false,
  compact: false,
};

export type BillLayout = {
  /** The physical sheet that goes through the printer. */
  sheet: { widthMm: number; heightMm: number };
  /** The space for one bill (a whole sheet, or the top or bottom half of one). */
  bill: { widthMm: number; heightMm: number };
  perSheet: 1 | 2;
  /** 2 when both halves of a sheet hold the same bill (two copies per A5). */
  copies: 1 | 2;
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
  if (s.twoCopiesPerA5) {
    return {
      sheet: { widthMm: 148, heightMm: 210 },
      bill: { widthMm: 148, heightMm: 105 },
      perSheet: 2,
      copies: 2,
    };
  }
  if (s.twoPerA4) {
    return {
      sheet: { widthMm: 210, heightMm: 297 },
      bill: { widthMm: 210, heightMm: 148.5 },
      perSheet: 2,
      copies: 1,
    };
  }
  const size = paperSize(s);
  return { sheet: size, bill: size, perSheet: 1, copies: 1 };
}

/**
 * Groups bills into printed sheets: one per sheet, pairs when printing two per A4, or each bill
 * next to its own copy when printing two copies per A5.
 */
export function toSheets<T>(items: T[], perSheet: 1 | 2, copies: 1 | 2 = 1): T[][] {
  if (copies === 2) return items.map((item) => [item, item]);
  const sheets: T[][] = [];
  for (let i = 0; i < items.length; i += perSheet) sheets.push(items.slice(i, i + perSheet));
  return sheets;
}

const mm = (n: number) => `${Number(n.toFixed(2))}mm`;

/**
 * Print CSS for a page of bills. One bill per sheet: the page margin is the setting and a long bill
 * flows onto further pages. Two per sheet (two per A4, or two copies per A5): no page margin, each
 * half gets the margin as padding, with a dashed cut line between the halves.
 */
export function billPageCss(s: PrintSettings): string {
  const layout = billLayout(s);
  const common = `.print-root { font-size: ${s.fontSizePt}pt; }`;
  if (layout.perSheet === 2) {
    const { sheet, bill } = layout;
    return [
      `@page { size: ${mm(sheet.widthMm)} ${mm(sheet.heightMm)}; margin: 0; }`,
      common,
      `@media print {`,
      `  .print-sheet { width: ${mm(sheet.widthMm)}; height: ${mm(sheet.heightMm)}; break-after: page; display: flex; flex-direction: column; }`,
      `  .print-sheet:last-child { break-after: auto; }`,
      `  .print-bill { height: ${mm(bill.heightMm)}; padding: ${mm(s.marginMm)}; overflow: hidden; box-sizing: border-box; }`,
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
  if (s.twoCopiesPerA5) return "Prints 2 copies of each bill per A5 sheet";
  if (s.twoPerA4) return "Prints 2 bills per A4 sheet";
  if (s.paper === "CUSTOM") {
    const { widthMm, heightMm } = paperSize(s);
    return `Prints on ${widthMm} × ${heightMm} mm paper`;
  }
  return `Prints on ${PAPER_LABEL[s.paper]}`;
}
