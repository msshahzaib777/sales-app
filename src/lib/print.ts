// Print layout rules (SPEC §11), shared by every printable page. Pure, so they are unit-tested.
//
// Bills print on the tenant's paper (A5 by default; A4, half-A4, A6 or a custom size), two to an
// A4 sheet, or two copies of the same bill side by side on one A5 sheet turned sideways (ORIGINAL
// and DUPLICATE). Statements and reports print on A4. Margins and font size are tenant settings.

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
  /**
   * Each bill printed twice on one A5 sheet turned sideways (210 × 148 mm): two tall halves side
   * by side, ORIGINAL and DUPLICATE, with a cut line; always the compact bill.
   */
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
  /** The halves side by side (two copies per A5, sideways) rather than one above the other. */
  sideBySide: boolean;
};

/** Two copies per A5: the copies, left to right. */
export const COPY_LABELS = ["ORIGINAL", "DUPLICATE"] as const;
/** Two copies per A5: the space around each copy (a thin edge, as on small-printer bills). */
export const COPY_MARGIN_MM = 4;
/**
 * Two copies per A5: the text starts bigger than the setting for readability, and shrinks (to
 * no less than COPY_MIN_FONT_PT) only when a long bill would not fit its half otherwise.
 */
export const COPY_FONT_PT = 11;
export const COPY_MIN_FONT_PT = 7;
export const copyFontPt = (s: Pick<PrintSettings, "fontSizePt">) =>
  Math.max(s.fontSizePt, COPY_FONT_PT);

/** The short bill layout: chosen in Settings, and always for two copies per A5. */
export const usesCompactBill = (s: PrintSettings) => Boolean(s.compact || s.twoCopiesPerA5);

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
      sheet: { widthMm: 210, heightMm: 148 },
      bill: { widthMm: 105, heightMm: 148 },
      perSheet: 2,
      copies: 2,
      sideBySide: true,
    };
  }
  if (s.twoPerA4) {
    return {
      sheet: { widthMm: 210, heightMm: 297 },
      bill: { widthMm: 210, heightMm: 148.5 },
      perSheet: 2,
      copies: 1,
      sideBySide: false,
    };
  }
  const size = paperSize(s);
  return { sheet: size, bill: size, perSheet: 1, copies: 1, sideBySide: false };
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
  if (layout.sideBySide) {
    const { sheet, bill } = layout;
    return [
      `@page { size: ${mm(sheet.widthMm)} ${mm(sheet.heightMm)}; margin: 0; }`,
      `.print-root { font-size: ${copyFontPt(s)}pt; }`,
      `@media print {`,
      `  .print-sheet { width: ${mm(sheet.widthMm)}; height: ${mm(sheet.heightMm)}; break-after: page; display: flex; flex-direction: row; }`,
      `  .print-sheet:last-child { break-after: auto; }`,
      `  .print-bill { width: ${mm(bill.widthMm)}; height: ${mm(bill.heightMm)}; padding: ${mm(COPY_MARGIN_MM)}; overflow: hidden; box-sizing: border-box; position: relative; }`,
      `  .print-bill + .print-bill { border-left: 1px dashed #000; }`,
      `}`,
    ].join("\n");
  }
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

/**
 * Trip sheets (loading sheet, driver sheet, or both front and back): A4 turned sideways with a
 * 7 mm margin, so the two can be printed on the two sides of one sheet. The driver sheet's table
 * is in compact text; the loading sheet is one page box whose text starts large and shrinks only
 * as much as a big load needs to stay on that one page (the front).
 */
export const TRIP_SHEET_PAGE_MM = { width: 297, height: 210, margin: 7 } as const;
export const DRIVER_SHEET_FONT_PT = 9;
export const LOADING_SHEET_FONT_PT = 13;
export const LOADING_SHEET_MIN_FONT_PT = 7;

export function tripSheetCss(): string {
  const { width, height, margin } = TRIP_SHEET_PAGE_MM;
  return [
    `@page { size: ${mm(width)} ${mm(height)}; margin: ${mm(margin)}; }`,
    `.print-root { font-size: ${DRIVER_SHEET_FONT_PT}pt; }`,
    // The loading sheet: exactly one page, on screen too (so the fitting measures the print).
    `.loading-page { width: ${mm(width - 2 * margin)}; height: ${mm(height - 2 * margin - 1)}; overflow: hidden; box-sizing: border-box; }`,
    `@media print { .loading-page { break-after: page; } .loading-page:last-child { break-after: auto; } }`,
  ].join("\n");
}

/** "Prints on A5 (148 × 210 mm)" and similar, shown next to the print button. */
export function paperHint(s: PrintSettings): string {
  if (s.twoCopiesPerA5) return "Prints 2 copies of each bill side by side on A5, sideways";
  if (s.twoPerA4) return "Prints 2 bills per A4 sheet";
  if (s.paper === "CUSTOM") {
    const { widthMm, heightMm } = paperSize(s);
    return `Prints on ${widthMm} × ${heightMm} mm paper`;
  }
  return `Prints on ${PAPER_LABEL[s.paper]}`;
}
