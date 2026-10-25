import type { Metadata } from "next";
import Link from "next/link";

import { Prisma } from "@/generated/prisma/client";
import { TripDayEndForm } from "@/components/delivery/trip-day-end-form";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { orNotFound } from "@/components/master/page-helpers";
import { OrderStatusBadge } from "@/components/sales/order-badges";
import { formatDate, toDateInput } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import type { DiscountType } from "@/lib/pricing";
import { requireTenantContext } from "@/server/auth/session";
import { saveTripDayEndAction } from "@/server/delivery-actions";
import { getTripDayEnd } from "@/server/services/delivery/day-end";

export const metadata: Metadata = { title: "Trip day-end" };

/** Day-end for every order of a trip on one page (orders already entered are listed below). */
export default async function TripDayEndPage({ params }: PageProps<"/delivery/[id]/day-end">) {
  const { id } = await params;
  const ctx = await requireTenantContext("operations.manage");
  const trip = await orNotFound(getTripDayEnd(ctx, id));
  // Money adds up as decimals, never floats (CLAUDE.md rule 5).
  const sum = (payments: { amount: Prisma.Decimal }[]) =>
    payments.reduce((s, p) => s.add(p.amount), new Prisma.Decimal(0));

  return (
    <div className="space-y-6">
      <div>
        <BackLink href={`/delivery/${id}`}>Trip #{trip.number}</BackLink>
        <PageHeader
          title={`Day-end · trip #${trip.number}`}
          description={`${formatDate(trip.tripDate)} · ${trip.bike.name} · ${trip.driver?.name ?? "no driver set"} · ${trip.pending.length} to enter, ${trip.entered.length} done`}
        />
      </div>

      {trip.status === "PLANNED" ? (
        <p className="text-sm">This trip has not been dispatched yet.</p>
      ) : trip.pending.length === 0 ? (
        <p className="text-sm">
          Every order on this trip is entered.{" "}
          <Link href={`/delivery/${id}`} className="underline underline-offset-4">
            Back to the trip
          </Link>
        </p>
      ) : (
        <TripDayEndForm
          // Keyed by the trip, not its orders: after a partial save the saved orders drop off and
          // the ones held back keep what was typed and their errors.
          key={trip.id}
          action={saveTripDayEndAction.bind(null, id)}
          tripDate={toDateInput(trip.tripDate)}
          orders={trip.pending.map((o) => ({
            id: o.id,
            number: o.number,
            customer: o.customer.name,
            detail: [o.customer.shopName, o.customer.area?.name, `bill #${o.bill?.number}`]
              .filter(Boolean)
              .join(" · "),
            phone: o.customer.phone,
            previous: o.bill!.previousBalance.toFixed(2),
            billBefore: o.bill!.netAmount.toFixed(2),
            creditLimit: o.customer.creditLimit?.toFixed(2) ?? null,
            lines: o.lines.map((l) => ({
              productId: l.productId,
              companyId: l.companyId,
              quantity: l.quantity,
              rate: l.rate.toFixed(2),
              discountType: l.discountType as DiscountType,
              discountValue: l.discountValue.toFixed(2),
              code: l.product.code,
              name: l.product.name,
              companyName: l.company.name,
            })),
          }))}
        />
      )}

      {trip.entered.length > 0 ? (
        <section aria-labelledby="entered-heading" className="space-y-2">
          <h2 id="entered-heading" className="font-medium">
            Already entered
          </h2>
          <ul className="divide-y rounded-lg border text-sm">
            {trip.entered.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                <Link
                  href={`/delivery/${id}/day-end/${o.id}`}
                  className="underline underline-offset-4"
                >
                  #{o.number} {o.customer.name}
                </Link>
                <span className="flex items-center gap-2">
                  <OrderStatusBadge status={o.status} />
                  bill {formatMoney(o.bill?.netAmount)} · collected{" "}
                  {formatMoney(sum(o.payments).toFixed(2))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
