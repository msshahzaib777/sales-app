import type { Metadata } from "next";
import Link from "next/link";

import { ConfirmAction } from "@/components/form/confirm-action";
import { DataTable, Td, Th } from "@/components/list/data-table";
import { BackLink, PageHeader } from "@/components/layout/page-header";
import { Notice } from "@/components/master/notice";
import { LinkButton, orNotFound } from "@/components/master/page-helpers";
import { PostingBadge, PurchaseOrderBadge } from "@/components/purchasing/status-badges";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { formatDozens } from "@/lib/units";
import { requireTenantContext } from "@/server/auth/session";
import { purchaseOrderStatusAction } from "@/server/purchasing-actions";
import { getPurchaseOrder } from "@/server/services/purchasing/purchase-orders";

export const metadata: Metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({
  params,
  searchParams,
}: PageProps<"/purchases/orders/[id]">) {
  const [{ id }, { notice }] = await Promise.all([params, searchParams]);
  const ctx = await requireTenantContext("operations.manage");
  const po = await orNotFound(getPurchaseOrder(ctx, id));
  const receivable = po.status === "OPEN" || po.status === "PARTIALLY_RECEIVED";
  const showRate = po.lines.some((l) => l.rate !== null);

  return (
    <div className="space-y-6">
      <div>
        <BackLink href="/purchases">Purchase orders</BackLink>
        <PageHeader
          title={`Purchase order #${po.number}`}
          description={`${po.company.name} · ${po.warehouse.name} · ordered ${formatDate(po.orderDate)}${po.expectedDate ? ` · expected ${formatDate(po.expectedDate)}` : ""}`}
          actions={
            <>
              {receivable ? (
                <LinkButton href={`/purchases/receipts/new?purchaseOrderId=${po.id}`}>
                  Receive goods
                </LinkButton>
              ) : null}
              {po.status === "OPEN" && !po.hasReceipts ? (
                <LinkButton href={`/purchases/orders/${po.id}/edit`} variant="outline">
                  Edit
                </LinkButton>
              ) : null}
            </>
          }
        />
        <Notice notice={notice} />
        <PurchaseOrderBadge status={po.status} />
        {po.note ? <p className="mt-2 text-sm">{po.note}</p> : null}
      </div>

      <section aria-labelledby="lines-heading">
        <h2 id="lines-heading" className="mb-2 font-medium">
          Ordered vs received
        </h2>
        <DataTable>
          <thead>
            <tr>
              <Th>Code</Th>
              <Th>Product</Th>
              <Th className="text-right">Ordered</Th>
              <Th className="text-right">Received</Th>
              <Th className="text-right">Difference</Th>
              {showRate ? <Th className="text-right">Rate / dz</Th> : null}
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l) => (
              <tr key={l.id}>
                <Td className="font-mono">{l.product.code}</Td>
                <Td>{l.product.name}</Td>
                <Td className="text-right tabular-nums">{formatDozens(l.quantity)}</Td>
                <Td className="text-right tabular-nums">{formatDozens(l.received)}</Td>
                <Td className="text-right tabular-nums">
                  {l.variance === 0
                    ? "—"
                    : `${l.variance > 0 ? "+" : ""}${formatDozens(l.variance)}`}
                  {l.variance < 0 ? <span className="sr-only"> short</span> : null}
                </Td>
                {showRate ? (
                  <Td className="text-right tabular-nums">{formatMoney(l.rate)}</Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </DataTable>
      </section>

      <section aria-labelledby="receipts-heading">
        <h2 id="receipts-heading" className="mb-2 font-medium">
          Goods receipts
        </h2>
        {po.goodsReceipts.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing received yet.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {po.goodsReceipts.map((r) => (
              <li key={r.id} className="flex items-center gap-2">
                <Link href={`/purchases/receipts/${r.id}`} className="underline underline-offset-4">
                  Receipt #{r.number}
                </Link>
                <span className="text-muted-foreground">{formatDate(r.receivedDate)}</span>
                <PostingBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-wrap gap-2 print:hidden">
        {po.status === "OPEN" && !po.hasReceipts ? (
          <ConfirmAction
            action={purchaseOrderStatusAction.bind(null, po.id, "CANCELLED")}
            label="Cancel order"
            confirm={`Cancel purchase order #${po.number}?`}
          />
        ) : null}
        {po.status === "PARTIALLY_RECEIVED" ? (
          <ConfirmAction
            action={purchaseOrderStatusAction.bind(null, po.id, "CLOSED")}
            label="Close (rest will not come)"
            confirm={`Close purchase order #${po.number}? The missing quantities will no longer be expected.`}
          />
        ) : null}
      </div>
    </div>
  );
}
