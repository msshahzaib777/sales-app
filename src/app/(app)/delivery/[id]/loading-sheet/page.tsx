import type { Metadata } from "next";

import { LoadingSheet } from "@/components/delivery/trip-sheets";
import { orNotFound } from "@/components/master/page-helpers";
import { FitText } from "@/components/print/fit-copies";
import { PrintStyles, PrintToolbar } from "@/components/print/print-frame";
import { LOADING_SHEET_FONT_PT, LOADING_SHEET_MIN_FONT_PT, tripSheetCss } from "@/lib/print";
import { requireTenantContext } from "@/server/auth/session";
import { getTrip } from "@/server/services/delivery/trips";
import { getPrintProfile } from "@/server/services/settings";

export const metadata: Metadata = { title: "Loading sheet" };

/** What to load on the bike and the stops in visiting order: one page, A4 sideways. */
export default async function LoadingSheetPage({
  params,
}: PageProps<"/delivery/[id]/loading-sheet">) {
  const { id } = await params;
  const ctx = await requireTenantContext("operations.manage");
  const [trip, profile] = await Promise.all([orNotFound(getTrip(ctx, id)), getPrintProfile(ctx)]);
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
        hint="Prints on A4 sideways (landscape): the page sets it, so the dialog shows no layout choice."
      />
      <div className="overflow-x-auto print:overflow-visible">
        <LoadingSheet trip={trip} business={profile.business} />
      </div>
    </div>
  );
}
