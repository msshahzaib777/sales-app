import "server-only";

import type { PrintSettings } from "@/lib/print";
import { businessSettingsSchema, MAX_LOGO_BYTES, sniffLogoType } from "@/lib/validation/settings";

import { writeAudit } from "../audit";
import { assertCan } from "../auth/permissions";
import { ServiceError } from "./errors";
import type { ServiceCtx } from "./master/common";

// Business details and print settings of the signed-in tenant (Settings → Business & printing).

export type PrintProfile = {
  business: { name: string; address: string | null; phone: string | null; logoUrl: string | null };
  print: PrintSettings;
};

/** What every printed page needs: letterhead and paper settings. Any tenant user. */
export async function getPrintProfile(ctx: ServiceCtx): Promise<PrintProfile> {
  const t = await ctx.db.tenant.findUniqueOrThrow({ where: { id: ctx.user.tenantId } });
  return {
    business: { name: t.name, address: t.address, phone: t.phone, logoUrl: t.logoUrl },
    print: {
      paper: t.billPaper,
      widthMm: t.billPaperWidthMm,
      heightMm: t.billPaperHeightMm,
      marginMm: t.printMarginMm,
      fontSizePt: t.printFontSizePt,
      twoPerA4: t.twoBillsPerA4,
    },
  };
}

const settingsFields = {
  name: true,
  address: true,
  phone: true,
  billPaper: true,
  billPaperWidthMm: true,
  billPaperHeightMm: true,
  printMarginMm: true,
  printFontSizePt: true,
  twoBillsPerA4: true,
} as const;

export async function getBusinessSettings(ctx: ServiceCtx) {
  assertCan(ctx.user.role, "settings.manage");
  return ctx.db.tenant.findUniqueOrThrow({
    where: { id: ctx.user.tenantId },
    select: { ...settingsFields, logoUrl: true },
  });
}

export async function updateBusinessSettings(ctx: ServiceCtx, input: unknown) {
  assertCan(ctx.user.role, "settings.manage");
  const data = businessSettingsSchema.parse(input);
  return ctx.db.$transaction(async (tx) => {
    const before = await tx.tenant.findUniqueOrThrow({
      where: { id: ctx.user.tenantId },
      select: settingsFields,
    });
    const after = await tx.tenant.update({
      where: { id: ctx.user.tenantId },
      data,
      select: settingsFields,
    });
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "Tenant",
      entityId: ctx.user.tenantId,
      oldValue: before,
      newValue: after,
    });
    return after;
  });
}

/** Stores the logo as a data: URL after checking its real type (by content) and size. */
export async function setLogo(ctx: ServiceCtx, file: { bytes: Uint8Array } | null) {
  assertCan(ctx.user.role, "settings.manage");
  let logoUrl: string | null = null;
  if (file) {
    if (file.bytes.length === 0) throw new ServiceError("Choose an image file.");
    if (file.bytes.length > MAX_LOGO_BYTES)
      throw new ServiceError(
        "The logo must be 200 KB or smaller. Save it smaller (e.g. 400 px wide) and try again.",
      );
    const type = sniffLogoType(file.bytes);
    if (!type) throw new ServiceError("Use a PNG, JPEG or WebP image for the logo.");
    logoUrl = `data:${type};base64,${Buffer.from(file.bytes).toString("base64")}`;
  }
  await ctx.db.$transaction(async (tx) => {
    await tx.tenant.update({ where: { id: ctx.user.tenantId }, data: { logoUrl } });
    await writeAudit(tx, ctx.user, {
      action: "UPDATE",
      entityType: "Tenant",
      entityId: ctx.user.tenantId,
      newValue: { logo: logoUrl ? `uploaded (${file!.bytes.length} bytes)` : "removed" },
    });
  });
}
