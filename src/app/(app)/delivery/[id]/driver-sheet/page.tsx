import type { Metadata } from "next";

import { DriverSheet } from "@/components/delivery/trip-sheets";
import { orNotFound } from "@/components/master/page-helpers";
import { PrintStyles, PrintToolbar } from "@/components/print/print-frame";
import { tripSheetCss } from "@/lib/print";
import { requireTenantContext } from "@/server/auth/session";
import { getDriverSheet } from "@/server/services/delivery/trips";
import { getPrintProfile } from "@/server/services/settings";

export const metadata: Metadata = { title: "Driver sheet" };

/** The sheet the driver fills in at each shop: one continuous table, A4 sideways. */
export default async function DriverSheetPage({
  params,
}: PageProps<"/delivery/[id]/driver-sheet">) {
  const { id } = await params;
  const ctx = await requireTenantContext("operations.manage");
  const [trip, profile] = await Promise.all([
    orNotFound(getDriverSheet(ctx, id)),
    getPrintProfile(ctx),
  ]);
  return (
    <div className="print-root">
      <PrintStyles css={tripSheetCss()} />
      <PrintToolbar
        back={{ href: `/delivery/${id}`, label: `Trip #${trip.number}` }}
        hint="Best on A4, Layout: Landscape (the browser remembers it). For two-sided and all printer options: Print using system dialog (Ctrl+Shift+P). Enter it at day-end in the same order."
      />
      {/* On a narrow screen the sheet scrolls sideways instead of squeezing its columns. */}
      <div className="overflow-x-auto print:overflow-visible">
        <div className="min-w-[283mm] print:min-w-0">
          <DriverSheet trip={trip} business={profile.business} />
        </div>
      </div>
    </div>
  );
}
