import type { Metadata } from "next";
import Link from "next/link";

import { LoadText, TripStatusBadge } from "@/components/delivery/trip-badge";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable, EmptyRow, Td, Th } from "@/components/list/data-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { Notice } from "@/components/master/notice";
import { LinkButton } from "@/components/master/page-helpers";
import { businessToday, formatDate, toDateInput } from "@/lib/dates";
import { TRIP_STATUS_LABEL } from "@/lib/delivery";
import { formatMoney } from "@/lib/format";
import { filterParam, listParamsSchema } from "@/lib/list-params";
import { requireTenantContext } from "@/server/auth/session";
import { listTrips } from "@/server/services/delivery/trips";
import { parseDateRange } from "@/server/services/purchasing/filters";

export const metadata: Metadata = { title: "Delivery" };

const STATUS_OPTIONS = [
  { value: "open", label: "Open (planned or out)" },
  ...Object.entries(TRIP_STATUS_LABEL).map(([value, label]) => ({ value, label })),
];

export default async function DeliveryPage({ searchParams }: PageProps<"/delivery">) {
  const sp = await searchParams;
  const { q, page } = listParamsSchema.parse(sp);
  const ctx = await requireTenantContext("operations.manage");
  const list = await listTrips(ctx, {
    q,
    page,
    status: filterParam(sp, "tripStatus"),
    ...parseDateRange(sp),
  });
  const tomorrow = new Date(businessToday().getTime() + 86_400_000);

  return (
    <>
      <PageHeader
        title="Delivery"
        description="Put the day's orders on bikes, dispatch them, and enter day-end results when drivers return."
        actions={
          <LinkButton href={`/delivery/new?date=${toDateInput(tomorrow)}`}>Plan a trip</LinkButton>
        }
      />
      <Notice notice={sp.notice} />
      <ListToolbar
        basePath="/delivery"
        params={{ q, status: "all" }}
        showStatus={false}
        searchPlaceholder="Trip no., bike or driver"
        dateRange={{ from: filterParam(sp, "from"), to: filterParam(sp, "to"), label: "Trip" }}
        filters={[
          {
            name: "tripStatus",
            label: "Status",
            value: filterParam(sp, "tripStatus"),
            options: STATUS_OPTIONS,
          },
        ]}
      />
      <DataTable>
        <thead>
          <tr>
            <Th>Trip</Th>
            <Th>Date</Th>
            <Th>Bike</Th>
            <Th>Driver</Th>
            <Th className="text-right">Load</Th>
            <Th className="text-right">Orders</Th>
            <Th className="text-right">Bills</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 ? (
            <EmptyRow colSpan={8}>No trips match these filters.</EmptyRow>
          ) : null}
          {list.rows.map((t) => (
            <tr key={t.id}>
              <Td>
                <Link
                  href={`/delivery/${t.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  #{t.number}
                </Link>
              </Td>
              <Td className="whitespace-nowrap">{formatDate(t.tripDate)}</Td>
              <Td>{t.bike.name}</Td>
              <Td>{t.driver.name}</Td>
              <Td className="text-right tabular-nums">
                <LoadText load={t.load} capacity={t.bike.capacity} />
              </Td>
              <Td className="text-right tabular-nums">
                {t.status === "DISPATCHED"
                  ? `${t.reconciledCount} of ${t.orderCount} entered`
                  : t.orderCount}
              </Td>
              <Td className="text-right tabular-nums">{formatMoney(t.billTotal)}</Td>
              <Td>
                <TripStatusBadge status={t.status} />
              </Td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <Pagination
        basePath="/delivery"
        searchParams={sp}
        page={list.page}
        pageCount={list.pageCount}
        total={list.total}
      />
    </>
  );
}
