import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { assertCan } from "../auth/permissions";
import type { ServiceCtx } from "./master/common";
import { found } from "./posting";
import { LEDGER_TYPE_LABEL } from "./purchasing/company-ledger";
import type { DateRange } from "./purchasing/filters";

// Customer statement (SPEC §8 views "customer, all companies" and "customer × company"): every
// bill, payment and adjustment with a running balance of what the customer owes. Printed and
// handed or sent to the customer.

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

export async function getCustomerStatement(
  ctx: ServiceCtx,
  customerId: string,
  opts: DateRange & { companyId?: string },
) {
  assertCan(ctx.user.role, "ledgers.view");
  const customer = found(
    await ctx.db.customer.findUnique({
      where: { id: customerId },
      include: { area: { select: { name: true } } },
    }),
    "customer",
  );
  const base = {
    partyType: "CUSTOMER" as const,
    customerId,
    ...(opts.companyId ? { companyId: opts.companyId } : {}),
  };

  const before = opts.from
    ? await ctx.db.ledgerEntry.aggregate({
        where: { ...base, entryDate: { lt: opts.from } },
        _sum: { debit: true, credit: true },
      })
    : null;
  const opening = before ? D(before._sum.debit ?? 0).sub(before._sum.credit ?? 0) : D(0);

  const [entries, companies, perCompany] = await Promise.all([
    ctx.db.ledgerEntry.findMany({
      where: {
        ...base,
        ...(opts.from || opts.to
          ? {
              entryDate: {
                ...(opts.from ? { gte: opts.from } : {}),
                ...(opts.to ? { lte: opts.to } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }],
    }),
    ctx.db.company.findMany({ select: { id: true, name: true } }),
    ctx.db.ledgerEntry.groupBy({
      by: ["companyId"],
      where: { partyType: "CUSTOMER", customerId },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  let balance = opening;
  const rows = entries.map((e) => {
    balance = balance.add(e.debit).sub(e.credit);
    return {
      id: e.id,
      entryDate: e.entryDate,
      typeLabel: LEDGER_TYPE_LABEL[e.type],
      description: e.description ?? "",
      companyName: companyName.get(e.companyId ?? "") ?? "",
      debit: e.debit,
      credit: e.credit,
      balance,
    };
  });

  return {
    customer: {
      id: customer.id,
      name: customer.name,
      shopName: customer.shopName,
      phone: customer.phone,
      address: customer.address,
      areaName: customer.area?.name ?? null,
    },
    company: opts.companyId
      ? { id: opts.companyId, name: companyName.get(opts.companyId) ?? "" }
      : null,
    range: { from: opts.from, to: opts.to },
    opening,
    rows,
    closing: balance,
    /** What the customer owes now per company (all dates), for the all-companies summary. */
    byCompany: perCompany
      .map((g) => ({
        companyId: g.companyId!,
        companyName: companyName.get(g.companyId!) ?? "",
        balance: D(g._sum.debit ?? 0).sub(g._sum.credit ?? 0),
      }))
      .filter((c) => !c.balance.isZero())
      .sort((a, b) => a.companyName.localeCompare(b.companyName)),
  };
}

export type CustomerStatement = Awaited<ReturnType<typeof getCustomerStatement>>;

/**
 * Company, all customers (SPEC §8): what each customer owes for this company's products, with the
 * period's movement. Customers with nothing owed and no movement are left out.
 */
export async function getCompanyReceivables(ctx: ServiceCtx, companyId: string, range: DateRange) {
  assertCan(ctx.user.role, "ledgers.view");
  const company = found(
    await ctx.db.company.findUnique({
      where: { id: companyId },
      include: { warehouse: { select: { name: true } } },
    }),
    "company",
  );
  const base = { partyType: "CUSTOMER" as const, companyId };
  const [before, during] = await Promise.all([
    range.from
      ? ctx.db.ledgerEntry.groupBy({
          by: ["customerId"],
          where: { ...base, entryDate: { lt: range.from } },
          _sum: { debit: true, credit: true },
        })
      : Promise.resolve([]),
    ctx.db.ledgerEntry.groupBy({
      by: ["customerId"],
      where: {
        ...base,
        ...(range.from || range.to
          ? {
              entryDate: {
                ...(range.from ? { gte: range.from } : {}),
                ...(range.to ? { lte: range.to } : {}),
              },
            }
          : {}),
      },
      _sum: { debit: true, credit: true },
    }),
  ]);
  const ids = [...new Set([...before, ...during].map((g) => g.customerId!))];
  const customers = await ctx.db.customer.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, shopName: true, area: { select: { name: true } } },
  });
  const opening = new Map(
    before.map((g) => [g.customerId!, D(g._sum.debit ?? 0).sub(g._sum.credit ?? 0)]),
  );
  const moves = new Map(during.map((g) => [g.customerId!, g]));
  const rows = customers
    .map((c) => {
      const o = opening.get(c.id) ?? D(0);
      const m = moves.get(c.id);
      const debit = D(m?._sum.debit ?? 0);
      const credit = D(m?._sum.credit ?? 0);
      return {
        customerId: c.id,
        name: c.name,
        shopName: c.shopName,
        areaName: c.area?.name ?? null,
        opening: o,
        debit,
        credit,
        closing: o.add(debit).sub(credit),
      };
    })
    .filter((r) => !r.closing.isZero() || !r.debit.isZero() || !r.credit.isZero())
    .sort((a, b) => b.closing.comparedTo(a.closing) || a.name.localeCompare(b.name));
  const total = (k: "opening" | "debit" | "credit" | "closing") =>
    rows.reduce((s, r) => s.add(r[k]), D(0));
  return {
    company: { id: company.id, name: company.name, warehouseName: company.warehouse.name },
    range,
    rows,
    totals: {
      opening: total("opening"),
      debit: total("debit"),
      credit: total("credit"),
      closing: total("closing"),
    },
  };
}
