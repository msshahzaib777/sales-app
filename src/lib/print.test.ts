import { describe, expect, it } from "vitest";

import {
  billLayout,
  billPageCss,
  COPY_LABELS,
  copyFontPt,
  DEFAULT_PRINT_SETTINGS,
  loadingSheetCss,
  paperHint,
  paperSize,
  statementPageCss,
  toSheets,
  usesCompactBill,
} from "./print";

describe("paper and layout", () => {
  it("knows the paper sizes, with A5 as the default and fallback", () => {
    expect(paperSize({ paper: "A5" })).toEqual({ widthMm: 148, heightMm: 210 });
    expect(paperSize({ paper: "HALF_A4" })).toEqual({ widthMm: 210, heightMm: 148.5 });
    expect(paperSize({ paper: "CUSTOM", widthMm: 80, heightMm: 200 })).toEqual({
      widthMm: 80,
      heightMm: 200,
    });
    expect(paperSize({ paper: "CUSTOM" })).toEqual({ widthMm: 148, heightMm: 210 });
  });

  it("puts two bills on an A4 sheet when asked", () => {
    expect(billLayout({ ...DEFAULT_PRINT_SETTINGS, twoPerA4: true })).toEqual({
      sheet: { widthMm: 210, heightMm: 297 },
      bill: { widthMm: 210, heightMm: 148.5 },
      perSheet: 2,
      copies: 1,
      sideBySide: false,
    });
    expect(billLayout({ ...DEFAULT_PRINT_SETTINGS, paper: "A6" }).perSheet).toBe(1);
  });

  it("groups bills into sheets", () => {
    expect(toSheets([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(toSheets([1, 2], 1)).toEqual([[1], [2]]);
  });
});

describe("print CSS", () => {
  it("one bill per page: the paper size and margin go on @page", () => {
    const css = billPageCss({ ...DEFAULT_PRINT_SETTINGS, marginMm: 6, fontSizePt: 9 });
    expect(css).toContain("@page { size: 148mm 210mm; margin: 6mm; }");
    expect(css).toContain(".print-root { font-size: 9pt; }");
  });

  it("two per A4: A4 page with no margin, each half padded and separated by a cut line", () => {
    const css = billPageCss({ ...DEFAULT_PRINT_SETTINGS, twoPerA4: true });
    expect(css).toContain("@page { size: 210mm 297mm; margin: 0; }");
    expect(css).toContain(".print-bill { height: 148.5mm; padding: 8mm;");
    expect(css).toContain("border-top: 1px dashed #000");
  });

  it("two copies per A5: A5 sideways, the same bill side by side, compact, bigger text", () => {
    const s = { ...DEFAULT_PRINT_SETTINGS, twoPerA4: true, twoCopiesPerA5: true };
    expect(billLayout(s)).toEqual({
      sheet: { widthMm: 210, heightMm: 148 },
      bill: { widthMm: 105, heightMm: 148 },
      perSheet: 2,
      copies: 2,
      sideBySide: true,
    });
    const css = billPageCss(s);
    expect(css).toContain("@page { size: 210mm 148mm; margin: 0; }");
    expect(css).toContain("flex-direction: row;");
    // Thin margins, whatever the margin setting (8 mm here).
    expect(css).toContain(".print-bill { width: 105mm; height: 148mm; padding: 4mm;");
    expect(css).toContain(".print-bill + .print-bill { border-left: 1px dashed #000; }");
    // Larger text than the 10 pt setting; a larger setting is kept.
    expect(css).toContain(".print-root { font-size: 11pt; }");
    expect(copyFontPt({ fontSizePt: 12 })).toBe(12);
    expect(COPY_LABELS).toEqual(["ORIGINAL", "DUPLICATE"]);
    expect(usesCompactBill(s)).toBe(true);
    expect(usesCompactBill(DEFAULT_PRINT_SETTINGS)).toBe(false);
    expect(toSheets(["a", "b"], 2, 2)).toEqual([
      ["a", "a"],
      ["b", "b"],
    ]);
    expect(paperHint(s)).toBe("Prints 2 copies of each bill side by side on A5, sideways");
  });

  it("the loading sheet prints on A4 in large text", () => {
    const css = loadingSheetCss(DEFAULT_PRINT_SETTINGS);
    expect(css).toContain("@page { size: 210mm 297mm; margin: 8mm; }");
    expect(css).toContain(".print-root { font-size: 13pt; }");
    expect(loadingSheetCss({ ...DEFAULT_PRINT_SETTINGS, fontSizePt: 14 })).toContain("14pt");
  });

  it("statements always print on A4", () => {
    expect(statementPageCss({ ...DEFAULT_PRINT_SETTINGS, paper: "A6", marginMm: 4 })).toContain(
      "@page { size: 210mm 297mm; margin: 8mm; }",
    );
  });
});

describe("paperHint", () => {
  it("names the paper", () => {
    expect(paperHint(DEFAULT_PRINT_SETTINGS)).toBe("Prints on A5 (148 × 210 mm)");
    expect(paperHint({ ...DEFAULT_PRINT_SETTINGS, twoPerA4: true })).toBe(
      "Prints 2 bills per A4 sheet",
    );
    expect(
      paperHint({ ...DEFAULT_PRINT_SETTINGS, paper: "CUSTOM", widthMm: 100, heightMm: 200 }),
    ).toBe("Prints on 100 × 200 mm paper");
  });
});
