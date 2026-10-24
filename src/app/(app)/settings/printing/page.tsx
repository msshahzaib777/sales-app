import type { Metadata } from "next";
import Link from "next/link";

import { RequirePermission } from "@/components/layout/no-access";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { BusinessSettingsForm, LogoForm } from "@/components/settings/business-settings-form";
import { requireTenantContext } from "@/server/auth/session";
import { getBusinessSettings } from "@/server/services/settings";
import {
  removeLogoAction,
  saveBusinessSettingsAction,
  uploadLogoAction,
} from "@/server/settings-actions";

export const metadata: Metadata = { title: "Business & printing" };

export default function PrintingSettingsPage() {
  return (
    <RequirePermission permission="settings.manage">
      <BackLink href="/settings">Settings</BackLink>
      <Settings />
    </RequirePermission>
  );
}

async function Settings() {
  const ctx = await requireTenantContext("settings.manage");
  const { logoUrl, ...values } = await getBusinessSettings(ctx);
  return (
    <div className="max-w-3xl space-y-8">
      <PageHeader
        title="Business & printing"
        description="Letterhead on bills and statements, paper size, margins and font size."
      />
      <BusinessSettingsForm action={saveBusinessSettingsAction} values={values} />
      <section aria-labelledby="logo-heading" className="space-y-2">
        <h2 id="logo-heading" className="font-medium">
          Logo
        </h2>
        <LogoForm upload={uploadLogoAction} remove={removeLogoAction} logoUrl={logoUrl} />
      </section>
      <p className="text-muted-foreground text-sm">
        To check the layout, open any order&apos;s bill from the{" "}
        <Link href="/orders" className="underline underline-offset-4">
          orders list
        </Link>{" "}
        and use the browser&apos;s print preview.
      </p>
    </div>
  );
}
