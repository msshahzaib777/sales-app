import { z } from "zod";

import { PAPER_SIZES } from "@/lib/print";

import { blankToUndefined, optionalText, phoneSchema, requiredText } from "./master";

const intIn = (label: string, min: number, max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.coerce
      .number({ error: `Enter the ${label}` })
      .int(`The ${label} must be a whole number`)
      .min(min, `The ${label} must be at least ${min}`)
      .max(max, `The ${label} must be at most ${max}`),
  );

export const businessSettingsSchema = z
  .object({
    name: requiredText("business name", 120),
    address: optionalText(200),
    phone: phoneSchema,
    billPaper: z.enum(PAPER_SIZES),
    billPaperWidthMm: z
      .preprocess(blankToUndefined, intIn("paper width", 50, 300).optional())
      .transform((v) => v ?? null),
    billPaperHeightMm: z
      .preprocess(blankToUndefined, intIn("paper height", 50, 420).optional())
      .transform((v) => v ?? null),
    printMarginMm: intIn("margin", 0, 30),
    printFontSizePt: intIn("font size", 7, 16),
    twoBillsPerA4: z
      .preprocess((v) => v === true || v === "on" || v === "true", z.boolean())
      .default(false),
  })
  .superRefine((s, ctx) => {
    if (s.billPaper === "CUSTOM") {
      if (s.billPaperWidthMm === null)
        ctx.addIssue({
          code: "custom",
          path: ["billPaperWidthMm"],
          message: "Enter the paper width",
        });
      if (s.billPaperHeightMm === null)
        ctx.addIssue({
          code: "custom",
          path: ["billPaperHeightMm"],
          message: "Enter the paper height",
        });
    }
  })
  .transform((s) =>
    s.billPaper === "CUSTOM" ? s : { ...s, billPaperWidthMm: null, billPaperHeightMm: null },
  );

export type BusinessSettingsInput = z.infer<typeof businessSettingsSchema>;

export const MAX_LOGO_BYTES = 200 * 1024;

/** The image type from the file's first bytes (not its name), or null if not PNG/JPEG/WebP. */
export function sniffLogoType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  const b = bytes;
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.length > 12 &&
    String.fromCharCode(...b.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...b.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  return null;
}
