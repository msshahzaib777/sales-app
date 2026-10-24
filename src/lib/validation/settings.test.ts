import { describe, expect, it } from "vitest";

import { businessSettingsSchema, sniffLogoType } from "./settings";

const base = { name: "Demo Snacks", billPaper: "A5", printMarginMm: "8", printFontSizePt: "10" };

describe("businessSettingsSchema", () => {
  it("accepts the defaults and drops custom sizes for standard paper", () => {
    expect(businessSettingsSchema.parse({ ...base, billPaperWidthMm: "80" })).toMatchObject({
      billPaper: "A5",
      billPaperWidthMm: null,
      printMarginMm: 8,
      twoBillsPerA4: false,
    });
  });

  it("requires width and height for a custom size, within limits", () => {
    expect(
      businessSettingsSchema
        .safeParse({ ...base, billPaper: "CUSTOM" })
        .error?.issues.map((i) => i.path[0]),
    ).toEqual(["billPaperWidthMm", "billPaperHeightMm"]);
    expect(
      businessSettingsSchema.safeParse({
        ...base,
        billPaper: "CUSTOM",
        billPaperWidthMm: "80",
        billPaperHeightMm: "200",
      }).success,
    ).toBe(true);
    expect(businessSettingsSchema.safeParse({ ...base, printFontSizePt: "30" }).success).toBe(
      false,
    );
  });
});

describe("sniffLogoType", () => {
  it("recognises PNG, JPEG and WebP by content, and rejects the rest", () => {
    expect(sniffLogoType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      "image/png",
    );
    expect(sniffLogoType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffLogoType(new TextEncoder().encode("RIFF1234WEBPVP8 "))).toBe("image/webp");
    expect(sniffLogoType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });
});
