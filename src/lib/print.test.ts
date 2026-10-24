import { describe, expect, it } from "vitest";

import {
  billLayout,
  billPageCss,
  DEFAULT_PRINT_SETTINGS,
  paperHint,
  paperSize,
  statementPageCss,
  toSheets,
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
