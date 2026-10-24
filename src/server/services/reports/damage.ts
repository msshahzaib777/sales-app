import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { businessToday, type Period, periodRange, PERIODS } from "@/lib/dates";
import { filterParam } from "@/lib/list-params";

import { assertCan, can } from "../../auth/permissions";
import type { ServiceCtx } from "../master/common";
import { type DateRange, parseDateRange } from "../purchasing/filters";

// Damage report: what was damaged in delivery (entered at day-end), by trip date, with the trip,
// driver, customer, product and company. Its value (purchase cost, as claimed) and what became of
// the claim are shown only to roles that see cost figures (CLAUDE.md rule 8).

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

export type DamageFilters = DateRange & {
  driverId?: string;
  tripId?: string;
  productId?: string;
  companyId?: string;
};

/**
 * Filters from the query string, shared by the page and the Excel export. `?period=this-week` etc.
 * sets the dates; otherwise ?from=&to=; with neither, this week.
 */
export function parseDamageFilters(sp: Record<string, unknown>): DamageFilters & {
  period?: Period;
} {
  const p = filterParam(sp, "period");
  const period = p && p in PERIODS ? (p as Period) : undefined;
  const typed = parseDateRange(sp);
  const range = period
    ? periodRange(period, businessToday())
    : typed.from || typed.to
      ? typed
      : periodRange("this-week", businessToday());
  return {
    ...range,
    period: period ?? (typed.from || typed.to ? undefined : "this-week"),
    driverId: filterParam(sp, "driverId"),
    tripId: filterParam(sp, "tripId"),
    productId: filterParam(sp, "productId"),
    companyId: filterParam(sp, "companyId"),
  };
}

export const CLAIM_STATUS_LABEL = {
  AWAITING: "Pending",
  PENDING: "Accepted",
  APPLIED: "Deducted",
  REJECTED: "Rejected",
  REVERSED: "Cancelled",
} as const;

export async function damageReport(ctx: ServiceCtx, f: DamageFilters) {
  assertCan(ctx.user.role, "operations.manage");
  const showValue = can(ctx.user.role, "financials.view");
  const lines = await ctx.db.salesOrderLine.findMany({
    where: {
      damagedQuantity: { gt: 0 },
      ...(f.productId ? { productId: f.productId } : {}),
      ...(f.companyId ? { companyId: f.companyId } : {}),
      salesOrder: {
        trip: {
          ...(f.tripId ? { id: f.tripId } : {}),
          ...(f.driverId ? { driverId: f.driverId } : {}),
          ...(f.from || f.to
            ? {
                tripDate: {
                  ...(f.from ? { gte: f.from } : {}),
                  ...(f.to ? { lte: f.to } : {}),
                },
              }
            : {}),
        },
      },
    },
    include: {
      product: { select: { code: true, name: true } },
      company: { select: { name: true } },
      salesOrder: {
        select: {
          id: true,
          number: true,
          customer: { select: { name: true, shopName: true } },
          trip: {
            select: {
              id: true,
              number: true,
              tripDate: true,
              driver: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
  const claims = showValue
    ? await ctx.db.companyClaim.findMany({
        where: {
          type: "DELIVERY_DAMAGE",
          status: { not: "REVERSED" },
          salesOrderId: { in: [...new Set(lines.map((l) => l.salesOrderId))] },
        },
        select: {
          salesOrderId: true,
          productId: true,
          status: true,
          amount: true,
          claimedAmount: true,
        },
      })
    : [];
  const claimOf = new Map(claims.map((c) => [`${c.salesOrderId}:${c.productId}`, c]));

  const rows = lines
    .map((l) => {
      const trip = l.salesOrder.trip!;
      const claim = claimOf.get(`${l.salesOrderId}:${l.productId}`);
      return {
        id: l.id,
        tripDate: trip.tripDate,
        tripId: trip.id,
        tripNumber: trip.number,
        driverName: trip.driver?.name ?? "Not set",
        orderId: l.salesOrder.id,
        orderNumber: l.salesOrder.number,
        customerName: l.salesOrder.customer.name,
        productCode: l.product.code,
        productName: l.product.name,
        companyName: l.company.name,
        quantity: l.damagedQuantity,
        claim: claim
          ? {
              status: claim.status,
              claimed: claim.claimedAmount ?? claim.amount,
              accepted:
                claim.status === "PENDING" || claim.status === "APPLIED" ? claim.amount : null,
            }
          : null,
      };
    })
    .sort(
      (a, b) =>
        a.tripDate.getTime() - b.tripDate.getTime() ||
        a.tripNumber - b.tripNumber ||
        a.orderNumber - b.orderNumber ||
        a.productCode.localeCompare(b.productCode),
    );

  const group = (key: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, { name: string; quantity: number; claimed: Prisma.Decimal }>();
    for (const r of rows) {
      const k = key(r);
      const g = m.get(k) ?? { name: k, quantity: 0, claimed: D(0) };
      g.quantity += r.quantity;
      if (r.claim) g.claimed = g.claimed.add(r.claim.claimed);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
  };

  return {
    showValue,
    rows,
    totals: {
      quantity: rows.reduce((s, r) => s + r.quantity, 0),
      claimed: rows.reduce((s, r) => (r.claim ? s.add(r.claim.claimed) : s), D(0)),
      accepted: rows.reduce((s, r) => (r.claim?.accepted ? s.add(r.claim.accepted) : s), D(0)),
    },
    byDriver: group((r) => r.driverName),
    byProduct: group((r) => `${r.productCode} ${r.productName}`),
  };
}

export type DamageReport = Awaited<ReturnType<typeof damageReport>>;

/** Filter choices: drivers, products, companies and the period's trips. */
export async function damageReportOptions(ctx: ServiceCtx, range: DateRange) {
  assertCan(ctx.user.role, "operations.manage");
  const [drivers, products, companies, trips] = await Promise.all([
    ctx.db.staff.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.db.product.findMany({
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
    ctx.db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ctx.db.deliveryTrip.findMany({
      where:
        range.from || range.to
          ? {
              tripDate: {
                ...(range.from ? { gte: range.from } : {}),
                ...(range.to ? { lte: range.to } : {}),
              },
            }
          : {},
      orderBy: [{ tripDate: "desc" }, { number: "desc" }],
      take: 200,
      select: { id: true, number: true, tripDate: true, bike: { select: { name: true } } },
    }),
  ]);
  return { drivers, products, companies, trips };
}
