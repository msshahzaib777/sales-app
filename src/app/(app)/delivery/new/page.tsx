import type { Metadata } from "next";

import { TripForm } from "@/components/delivery/trip-form";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { businessToday, formatDate, toDateInput } from "@/lib/dates";
import { requireTenantContext } from "@/server/auth/session";
import { createTripAction } from "@/server/delivery-actions";
import { bookedOrdersFor, tripFormOptions } from "@/server/services/delivery/trips";
import { dateRangeSchema } from "@/server/services/purchasing/filters";

export const metadata: Metadata = { title: "Plan a trip" };

export default async function NewTripPage({ searchParams }: PageProps<"/delivery/new">) {
  const sp = await searchParams;
  const date =
    dateRangeSchema.parse({ from: sp.date }).from ??
    new Date(businessToday().getTime() + 86_400_000);
  const ctx = await requireTenantContext("operations.manage");
  const [{ bikes, staff }, orders] = await Promise.all([
    tripFormOptions(ctx),
    bookedOrdersFor(ctx, date),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/delivery">Delivery</BackLink>
        <PageHeader
          title="Plan a trip"
          description={`Tick the booked orders for ${formatDate(date)} that go on one bike. You can add or remove orders until dispatch.`}
        />
      </div>
      <form method="get" className="flex items-end gap-2">
        <div className="space-y-1">
          <label htmlFor="date" className="text-muted-foreground text-xs font-medium">
            Delivery date
          </label>
          <Input
            id="date"
            name="date"
            type="date"
            defaultValue={toDateInput(date)}
            className="w-44"
          />
        </div>
        <Button type="submit" variant="secondary">
          Show orders
        </Button>
      </form>
      {bikes.length === 0 ? (
        <p className="text-sm">Add a bike under Settings → Delivery bikes first.</p>
      ) : (
        <TripForm
          key={toDateInput(date)}
          action={createTripAction}
          date={toDateInput(date)}
          bikes={bikes}
          staff={staff}
          orders={orders.map((o) => ({ ...o, amount: o.amount.toFixed(2) }))}
        />
      )}
    </div>
  );
}
