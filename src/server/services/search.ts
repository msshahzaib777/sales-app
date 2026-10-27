import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { formatDate } from "@/lib/dates";
import {
  icontains,
  matchEveryWord,
  phoneContains,
  searchNumber,
  searchWords,
} from "@/lib/list-params";

import { assertCan, can } from "../auth/permissions";
import type { ServiceCtx } from "./master/common";

// Search from anywhere (the "/" box): a few of each kind of record, so one box finds a customer,
// an order (by number, customer or product), a product, a company or a trip. Every word must match
// somewhere, in any order, like the list searches. Only what the user's role may open is returned.

export type SearchHit = { kind: SearchKind; title: string; detail: string; href: string };
export type SearchKind = "Customer" | "Order" | "Product" | "Company" | "Trip" | "Payment";

const PER_KIND = 5;

export async function globalSearch(ctx: ServiceCtx, q: string): Promise<SearchHit[]> {
  assertCan(ctx.user.role, "operations.manage");
  const query = q.trim().slice(0, 100);
  if (searchWords(query).length === 0) return [];
  const number = searchNumber(query);
  const payments = can(ctx.user.role, "payments.manage");

  const [customers, orders, products, companies, trips, paymentRows] = await Promise.all([
    ctx.db.customer.findMany({
      where: matchEveryWord(query, (w): Prisma.CustomerWhereInput[] => [
        { name: icontains(w) },
        { shopName: icontains(w) },
        { phone: phoneContains(w) },
        { area: { name: icontains(w) } },
      ]),
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      take: PER_KIND,
      select: {
        id: true,
        name: true,
        shopName: true,
        phone: true,
        isActive: true,
        area: { select: { name: true } },
      },
    }),
    ctx.db.salesOrder.findMany({
      where:
        number !== undefined
          ? { number }
          : matchEveryWord(query, (w): Prisma.SalesOrderWhereInput[] => [
              { customer: { name: icontains(w) } },
              { customer: { shopName: icontains(w) } },
              { lines: { some: { product: { code: icontains(w) } } } },
              { lines: { some: { product: { name: icontains(w) } } } },
            ]),
      orderBy: [{ deliveryDate: "desc" }, { number: "desc" }],
      take: PER_KIND,
      select: {
        id: true,
        number: true,
        status: true,
        deliveryDate: true,
        customer: { select: { name: true } },
      },
    }),
    ctx.db.product.findMany({
      where: matchEveryWord(query, (w): Prisma.ProductWhereInput[] => [
        { code: icontains(w) },
        { name: icontains(w) },
      ]),
      orderBy: [{ isActive: "desc" }, { code: "asc" }],
      take: PER_KIND,
      select: { id: true, code: true, name: true, company: { select: { name: true } } },
    }),
    ctx.db.company.findMany({
      where: matchEveryWord(query, (w): Prisma.CompanyWhereInput[] => [{ name: icontains(w) }]),
      orderBy: { name: "asc" },
      take: PER_KIND,
      select: { id: true, name: true },
    }),
    number !== undefined
      ? ctx.db.deliveryTrip.findMany({
          where: { number },
          take: PER_KIND,
          select: {
            id: true,
            number: true,
            tripDate: true,
            bike: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    payments && number !== undefined
      ? ctx.db.customerPayment.findMany({
          where: { number },
          take: PER_KIND,
          select: {
            id: true,
            number: true,
            amount: true,
            paymentDate: true,
            customer: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  return [
    ...orders.map((o) => ({
      kind: "Order" as const,
      title: `Order #${o.number} · ${o.customer.name}`,
      detail: `${formatDate(o.deliveryDate)} · ${o.status.toLowerCase().replace(/_/g, " ")}`,
      href: `/orders/${o.id}`,
    })),
    ...trips.map((t) => ({
      kind: "Trip" as const,
      title: `Trip #${t.number}`,
      detail: `${formatDate(t.tripDate)} · ${t.bike.name}`,
      href: `/delivery/${t.id}`,
    })),
    ...paymentRows.map((p) => ({
      kind: "Payment" as const,
      title: `Payment #${p.number} · ${p.customer.name}`,
      detail: `${formatDate(p.paymentDate)} · ${p.amount.toFixed(2)}`,
      href: `/payments/${p.id}`,
    })),
    ...customers.map((c) => ({
      kind: "Customer" as const,
      title: c.name,
      detail: [c.shopName, c.area?.name, c.phone, c.isActive ? null : "deactivated"]
        .filter(Boolean)
        .join(" · "),
      // Statements are for ledger roles; everyone else opens the customer record.
      href: can(ctx.user.role, "ledgers.view")
        ? `/customers/${c.id}/statement`
        : can(ctx.user.role, "masterData.manage")
          ? `/customers/${c.id}`
          : `/orders?q=${encodeURIComponent(c.name)}`,
    })),
    ...products.map((p) => ({
      kind: "Product" as const,
      title: `${p.code} ${p.name}`,
      detail: `${p.company.name} · stock card`,
      href: `/inventory/${p.id}`,
    })),
    ...companies.map((c) => ({
      kind: "Company" as const,
      title: c.name,
      detail: can(ctx.user.role, "ledgers.view") ? "company ledger" : "company stock",
      href: can(ctx.user.role, "ledgers.view")
        ? `/companies/${c.id}/ledger`
        : can(ctx.user.role, "masterData.manage")
          ? `/companies/${c.id}`
          : `/inventory?companyId=${c.id}`,
    })),
  ];
}
