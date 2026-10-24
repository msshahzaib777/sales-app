import type { Metadata } from "next";
import Link from "next/link";

import { orNotFound } from "@/components/master/page-helpers";
import { BillSheets } from "@/components/print/bill-sheets";
import { PrintToolbar } from "@/components/print/print-frame";
import { billDocuments } from "@/components/sales/bill-document";
import { Badge } from "@/components/ui/badge";
import { filterParam } from "@/lib/list-params";
import { paperHint } from "@/lib/print";
import { cn } from "@/lib/utils";
import { requireTenantContext } from "@/server/auth/session";
import { getBillView } from "@/server/services/sales/bills";
import { getPrintProfile } from "@/server/services/settings";

export const metadata: Metadata = { title: "Bill" };

export default async function BillPage({ params, searchParams }: PageProps<"/orders/[id]/bill">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const split = filterParam(sp, "view") === "company";
  const ctx = await requireTenantContext("operations.manage");
  const [view, profile] = await Promise.all([
    orNotFound(getBillView(ctx, id)),
    getPrintProfile(ctx),
  ]);
  const tab = (active: boolean) =>
    cn(
      "rounded-md border px-3 py-1.5 text-sm",
      active ? "bg-foreground text-background" : "hover:bg-accent",
    );

  return (
    <div>
      <PrintToolbar
        back={{ href: `/orders/${id}`, label: `Order #${view.order.number}` }}
        hint={paperHint(profile.print)}
      >
        <Link
          href={`/orders/${id}/bill`}
          className={tab(!split)}
          aria-current={!split ? "page" : undefined}
        >
          Full bill
        </Link>
        <Link
          href={`/orders/${id}/bill?view=company`}
          className={tab(split)}
          aria-current={split ? "page" : undefined}
        >
          Split by company ({view.sections.length})
        </Link>
        {view.bill.status === "REVERSED" ? <Badge variant="outline">Cancelled</Badge> : null}
        {!view.bill.posted && view.bill.status !== "REVERSED" ? (
          <span className="text-muted-foreground text-sm">
            Draft until dispatch: amounts can still change.
          </span>
        ) : null}
      </PrintToolbar>
      <BillSheets settings={profile.print} bills={billDocuments(view, profile.business, split)} />
    </div>
  );
}
