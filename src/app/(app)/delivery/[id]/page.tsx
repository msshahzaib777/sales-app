import type { Metadata } from "next";
import Link from "next/link";

import { LoadText, TripStatusBadge } from "@/components/delivery/trip-badge";
import { TripDriverForm } from "@/components/delivery/trip-driver-form";
import { AddOrdersForm } from "@/components/delivery/trip-form";
import { ConfirmAction } from "@/components/form/confirm-action";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { Notice } from "@/components/master/notice";
import { LinkButton, orNotFound } from "@/components/master/page-helpers";
import { OrderStatusBadge } from "@/components/sales/order-badges";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import {
  addOrdersToTripAction,
  cancelTripAction,
  dispatchTripAction,
  removeOrderFromTripAction,
  setTripDriverAction,
} from "@/server/delivery-actions";
import { bookedOrdersFor, getTrip, tripFormOptions } from "@/server/services/delivery/trips";

export const metadata: Metadata = { title: "Trip" };

export default async function TripPage({ params, searchParams }: PageProps<"/delivery/[id]">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireTenantContext("operations.manage");
  const trip = await orNotFound(getTrip(ctx, id));
  const planned = trip.status === "PLANNED";
  const out = trip.status === "DISPATCHED" || trip.status === "RECONCILED";
  const addable = planned ? await bookedOrdersFor(ctx, trip.tripDate, trip.warehouseId) : [];
  // The driver can be set or changed until day-end is done.
  const driverEditable = trip.status === "PLANNED" || trip.status === "DISPATCHED";
  const { staff } = driverEditable ? await tripFormOptions(ctx) : { staff: [] };
  const ids = trip.orders.map((o) => `ids=${o.id}`).join("&");
  const firstOpen = trip.orders.find((o) => o.status === "DISPATCHED");

  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/delivery">Delivery</BackLink>
        <PageHeader
          title={`Trip #${trip.number} · ${formatDate(trip.tripDate)}`}
          description={`${trip.bike.name} · ${trip.driver ? `driver ${trip.driver.name}${trip.driver.phone ? ` (${trip.driver.phone})` : ""}` : "driver not set"} · ${trip.warehouse.name}${trip.note ? ` · ${trip.note}` : ""}`}
          actions={
            <>
              {trip.orders.length > 0 ? (
                <>
                  <LinkButton href={`/delivery/${id}/loading-sheet`} variant="outline">
                    Loading sheet
                  </LinkButton>
                  <LinkButton href={`/orders/print?${ids}`} variant="outline">
                    Print bills
                  </LinkButton>
                </>
              ) : null}
              {firstOpen ? (
                <LinkButton href={`/delivery/${id}/day-end/${firstOpen.id}`}>
                  Enter day-end
                </LinkButton>
              ) : null}
            </>
          }
        />
      </div>
      <Notice notice={sp.notice} />
      {driverEditable ? (
        <TripDriverForm
          action={setTripDriverAction.bind(null, id)}
          driverId={trip.driverId}
          staff={staff}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <TripStatusBadge status={trip.status} />
        <span>
          Load <LoadText load={trip.totals.load} capacity={trip.bike.capacity} />
        </span>
        <span>
          Bills <strong className="tabular-nums">{formatMoney(trip.totals.bills)}</strong>
        </span>
        {out ? (
          <span>
            Collected: cash{" "}
            <strong className="tabular-nums">{formatMoney(trip.totals.cash)}</strong> · cheque{" "}
            <strong className="tabular-nums">{formatMoney(trip.totals.cheque)}</strong> · online{" "}
            <strong className="tabular-nums">{formatMoney(trip.totals.online)}</strong>
          </span>
        ) : null}
      </div>

      {planned ? (
        <div className="flex flex-wrap gap-2">
          <ConfirmAction
            action={dispatchTripAction.bind(null, id)}
            label="Dispatch trip"
            confirm={`Dispatch trip #${trip.number}? Stock leaves the warehouse and the bills post to the customer ledgers. Orders can no longer be edited.`}
          />
          <ConfirmAction
            action={cancelTripAction.bind(null, id)}
            label="Cancel trip"
            confirm={`Cancel trip #${trip.number}? Its orders go back to booked.`}
          />
        </div>
      ) : null}

      <section aria-labelledby="stops-heading">
        <h2 id="stops-heading" className="mb-2 font-medium">
          Stops
        </h2>
        <DataTable>
          <thead>
            <tr>
              <Th className="w-10">#</Th>
              <Th>Order</Th>
              <Th>Customer</Th>
              <Th>Area</Th>
              <Th className="text-right">{out ? "Delivered" : "Dozens"}</Th>
              <Th className="text-right">Bill</Th>
              {out ? <Th className="text-right">Collected</Th> : null}
              <Th>Status</Th>
              <Th>
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {trip.orders.length === 0 ? (
              <EmptyRow colSpan={9}>No orders on this trip.</EmptyRow>
            ) : null}
            {trip.orders.map((o, i) => (
              <tr key={o.id}>
                <Td className="tabular-nums">{i + 1}</Td>
                <Td>
                  <Link
                    href={`/orders/${o.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    #{o.number}
                  </Link>
                </Td>
                <Td>
                  {o.customer.name}
                  {o.customer.shopName ? (
                    <div className="text-muted-foreground">{o.customer.shopName}</div>
                  ) : null}
                </Td>
                <Td>{o.customer.area?.name ?? "—"}</Td>
                <Td className="text-right tabular-nums">
                  {out && o.reconciledAt
                    ? `${formatDozens(o.delivered)} of ${formatDozens(o.quantity)}`
                    : formatDozens(o.quantity)}
                </Td>
                <Td className="text-right tabular-nums">{formatMoney(o.bill?.netAmount)}</Td>
                {out ? (
                  <Td className="text-right tabular-nums">
                    {o.reconciledAt
                      ? formatMoney(
                          o.collected.CASH.add(o.collected.CHEQUE).add(o.collected.ONLINE),
                        )
                      : "—"}
                  </Td>
                ) : null}
                <Td>
                  <OrderStatusBadge status={o.status} needsCreditApproval={o.needsCreditApproval} />
                </Td>
                <Td className="text-right whitespace-nowrap">
                  {planned ? (
                    <ConfirmAction
                      action={removeOrderFromTripAction.bind(null, id, o.id)}
                      label="Remove"
                      confirm={`Take order #${o.number} off this trip? It goes back to booked.`}
                    />
                  ) : out ? (
                    <Link
                      href={`/delivery/${id}/day-end/${o.id}`}
                      className="text-sm underline underline-offset-4"
                    >
                      {o.reconciledAt ? "View day-end" : "Enter day-end"}
                    </Link>
                  ) : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </section>

      {planned ? (
        <section aria-labelledby="add-heading" className="space-y-2">
          <h2 id="add-heading" className="font-medium">
            Add booked orders for {formatDate(trip.tripDate)}
          </h2>
          <AddOrdersForm
            action={addOrdersToTripAction.bind(null, id)}
            capacity={Math.max(trip.bike.capacity - trip.totals.load, 0)}
            orders={addable.map((o) => ({ ...o, amount: o.amount.toFixed(2) }))}
          />
        </section>
      ) : null}
    </div>
  );
}
