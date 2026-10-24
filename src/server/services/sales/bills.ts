import "server-only";

import { Prisma } from "@/generated/prisma/client";

import { assertCan } from "../../auth/permissions";
import type { ServiceCtx } from "../master/common";
import { found } from "../posting";
import { customerPending } from "./positions";

// Bill view for screen and print: the current revision's lines, the split per company, and
// "previous pending + this bill = total due", overall and for each company's slice.

const D = (v: Prisma.Decimal | number | string) => new Prisma.Decimal(v);

type SnapshotLine = {
  productId: string;
  companyId: string;
  quantity: number;
  rate: string;
  discountType: string;
  discountValue: string;
  grossAmount: string;
  discountAmount: string;
  netAmount: string;
};
type SnapshotCompany = { companyId: string; netAmount: string; previousBalance?: string };

export async function getBillView(ctx: ServiceCtx, orderId: string) {
  assertCan(ctx.user.role, "operations.manage");
  const order = found(
    await ctx.db.salesOrder.findUnique({
      where: { id: orderId },
      include: {
        customer: { include: { area: { select: { name: true } } } },
        bill: { include: { revisions: { orderBy: { revision: "desc" }, take: 1 } } },
      },
    }),
    "order",
  );
  const bill = found(order.bill, "bill");
  const revision = bill.revisions[0]!;
  const snapshot = revision.lines as SnapshotLine[];
  const companyTotals = revision.companyTotals as SnapshotCompany[];

  const [products, companies, tenant] = await Promise.all([
    ctx.db.product.findMany({
      where: { id: { in: snapshot.map((l) => l.productId) } },
      select: { id: true, code: true, name: true },
    }),
    ctx.db.company.findMany({
      where: { id: { in: companyTotals.map((c) => c.companyId) } },
      select: { id: true, name: true },
    }),
    ctx.db.tenant.findUniqueOrThrow({ where: { id: ctx.user.tenantId } }),
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const companyName = new Map(companies.map((c) => [c.id, c.name]));

  // Previous pending: frozen when the bill is posted (dispatch); until then, the live balance
  // (this bill is not in the ledger yet, so the ledger balance is exactly "previous").
  const posted = bill.postedAt !== null;
  const live = posted ? null : await customerPending(ctx.db, order.customerId);
  const previousTotal = posted ? bill.previousBalance : live!.total;
  const previousFor = (companyId: string) => {
    if (live) return live.byCompany.get(companyId) ?? D(0);
    const frozen = companyTotals.find((c) => c.companyId === companyId)?.previousBalance;
    return D(frozen ?? 0);
  };

  const lines = snapshot.map((l) => ({
    ...l,
    code: productById.get(l.productId)?.code ?? "",
    name: productById.get(l.productId)?.name ?? "",
    companyName: companyName.get(l.companyId) ?? "",
  }));
  const sections = companyTotals
    .map((c) => {
      const previous = previousFor(c.companyId);
      return {
        companyId: c.companyId,
        companyName: companyName.get(c.companyId) ?? "",
        lines: lines.filter((l) => l.companyId === c.companyId),
        thisBill: D(c.netAmount),
        previous,
        totalDue: previous.add(c.netAmount),
      };
    })
    .sort((a, b) => a.companyName.localeCompare(b.companyName));

  return {
    tenant: { name: tenant.name, address: tenant.address, phone: tenant.phone },
    order: {
      id: order.id,
      number: order.number,
      status: order.status,
      deliveryDate: order.deliveryDate,
      orderDate: order.orderDate,
    },
    customer: {
      name: order.customer.name,
      shopName: order.customer.shopName,
      phone: order.customer.phone,
      address: order.customer.address,
      areaName: order.customer.area?.name ?? null,
    },
    bill: {
      id: bill.id,
      number: bill.number,
      billDate: bill.billDate,
      revision: bill.currentRevision,
      status: bill.status,
      posted,
      grossAmount: D(revision.grossAmount),
      discountAmount: D(revision.discountAmount),
      netAmount: D(revision.netAmount),
    },
    lines,
    sections,
    previous: previousTotal,
    totalDue: previousTotal.add(revision.netAmount),
  };
}

export type BillView = Awaited<ReturnType<typeof getBillView>>;
