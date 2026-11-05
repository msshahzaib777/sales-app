import type { Metadata } from "next";

import { DriverSheet, LoadingSheet } from "@/components/delivery/trip-sheets";
import { orNotFound } from "@/components/master/page-helpers";
import { FitText } from "@/components/print/fit-copies";
import { PrintStyles, PrintToolbar } from "@/components/print/print-frame";
import { LOADING_SHEET_FONT_PT, LOADING_SHEET_MIN_FONT_PT, tripSheetCss } from "@/lib/print";
import { requireTenantContext } from "@/server/auth/session";
import { getDriverSheet } from "@/server/services/delivery/trips";
import { getPrintProfile } from "@/server/services/settings";

export const metadata: Metadata = { title: "Loading and driver sheet" };

/**
 * Both trip sheets in one print, for the two sides of one sheet: the loading sheet on page 1 (it
 * always fits one page, so the driver sheet always starts on the back), then the driver sheet.
 * Both A4 sideways, so double-sided printing flips them the same way.
 */
export default async function TripSheetsPage({ params }: PageProps<"/delivery/[id]/trip-sheets">) {
  const { id } = await params;
  const ctx = await requireTenantContext("operations.manage");
  const [trip, profile] = await Promise.all([
    orNotFound(getDriverSheet(ctx, id)),
    getPrintProfile(ctx),
  ]);
  return (
    <div className="print-root">
      <PrintStyles css={tripSheetCss()} />
      <FitText
        selector=".loading-page[data-fit-page]"
        fontPt={LOADING_SHEET_FONT_PT}
        minPt={LOADING_SHEET_MIN_FONT_PT}
      />
      <PrintToolbar
        back={{ href: `/delivery/${id}`, label: `Trip #${trip.number}` }}
        hint="Page 1 loading sheet, then the driver sheet: in the print dialog turn on Print on both sides (two-sided), flip on short edge. A4 sideways."
      />
      <div className="overflow-x-auto print:overflow-visible">
        <div className="min-w-[283mm] space-y-8 print:space-y-0">
          <LoadingSheet trip={trip} business={profile.business} />
          <DriverSheet trip={trip} business={profile.business} />
        </div>
      </div>
    </div>
  );
}
