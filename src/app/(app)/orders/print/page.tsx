import type { Metadata } from "next";

import { BillSheets } from "@/components/print/bill-sheets";
import { PrintToolbar } from "@/components/print/print-frame";
import { billDocuments } from "@/components/sales/bill-document";
import { filterParam } from "@/lib/list-params";
import { paperHint } from "@/lib/print";
import { requireTenantContext } from "@/server/auth/session";
import { getBillViews, MAX_BULK_BILLS } from "@/server/services/sales/bills";
import { getPrintProfile } from "@/server/services/settings";

export const metadata: Metadata = { title: "Print bills" };

/** All bills of the orders ticked on the orders list (`?ids=…&ids=…`), ready to print in one go. */
export default async function PrintBillsPage({ searchParams }: PageProps<"/orders/print">) {
  const sp = await searchParams;
  const ids = (Array.isArray(sp.ids) ? sp.ids : sp.ids ? [sp.ids] : []).filter(Boolean);
  const split = filterParam(sp, "view") === "company";
  const ctx = await requireTenantContext("operations.manage");
  const back = { href: "/orders", label: "Orders" };

  if (ids.length === 0 || ids.length > MAX_BULK_BILLS) {
    return (
      <div>
        <PrintToolbar back={back} />
        <p role="alert" className="text-sm">
          {ids.length === 0
            ? "Tick the orders to print on the orders list first."
            : `Print at most ${MAX_BULK_BILLS} bills at a time; you selected ${ids.length}.`}
        </p>
      </div>
    );
  }

  const [{ views, skipped }, profile] = await Promise.all([
    getBillViews(ctx, ids),
    getPrintProfile(ctx),
  ]);
  const bills = views.flatMap((v) => billDocuments(v, profile.business, split));
  return (
    <div>
      <PrintToolbar back={back} hint={paperHint(profile.print)}>
        <p className="text-sm">
          {views.length} {views.length === 1 ? "bill" : "bills"}
          {split ? `, split by company into ${bills.length} pages` : ""}
          {skipped
            ? ` · ${skipped} selected ${skipped === 1 ? "order has" : "orders have"} no bill`
            : ""}
        </p>
      </PrintToolbar>
      <BillSheets settings={profile.print} bills={bills} />
    </div>
  );
}
