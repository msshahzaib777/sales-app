import type { Metadata } from "next";
import Link from "next/link";

import { BackLink } from "@/components/layout/page-header";
import { PrintButton } from "@/components/layout/print-button";
import { orNotFound } from "@/components/master/page-helpers";
import { BillDocument } from "@/components/sales/bill-document";
import { Badge } from "@/components/ui/badge";
import { filterParam } from "@/lib/list-params";
import { cn } from "@/lib/utils";
import { requireTenantContext } from "@/server/auth/session";
import { getBillView } from "@/server/services/sales/bills";

export const metadata: Metadata = { title: "Bill" };

export default async function BillPage({ params, searchParams }: PageProps<"/orders/[id]/bill">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const split = filterParam(sp, "view") === "company";
  const ctx = await requireTenantContext("operations.manage");
  const view = await orNotFound(getBillView(ctx, id));
  const tab = (active: boolean) =>
    cn(
      "rounded-md border px-3 py-1.5 text-sm",
      active ? "bg-foreground text-background" : "hover:bg-accent",
    );

  return (
    <div className="space-y-4">
      {/* A5 by default; paper size and margins become tenant settings in Task 7. */}
      <style>{`@media print { @page { size: A5; margin: 8mm; } .bill-page { break-after: page; } .bill-page:last-child { break-after: auto; } }`}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <BackLink href={`/orders/${id}`}>Order #{view.order.number}</BackLink>
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
        </div>
        <PrintButton />
      </div>

      {split ? (
        view.sections.map((s) => (
          <BillDocument
            key={s.companyId}
            view={view}
            title={`${s.companyName} portion`}
            lines={s.lines}
            thisBill={s.thisBill}
            previous={s.previous}
            totalDue={s.totalDue}
            showCompany={false}
          />
        ))
      ) : (
        <BillDocument
          view={view}
          lines={view.lines}
          thisBill={view.bill.netAmount}
          previous={view.previous}
          totalDue={view.totalDue}
          showCompany={view.sections.length > 1}
        />
      )}
    </div>
  );
}
